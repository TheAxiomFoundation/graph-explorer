import { describe, expect, test } from 'bun:test';
import axiomFixture from '../examples/fixtures/axiom-oasdi.json';
import thesisFixture from '../examples/fixtures/thesis-source-replay.json';
import { fromAxiomProgramGraph, type AxiomProgramGraph } from '../src/adapters/axiom';
import { fromThesisRecords, type ThesisRecord } from '../src/adapters/thesis';
import { axiomExample, thesisExample } from '../examples/adapter-examples';

describe('Axiom native compiled graph adapter', () => {
  test('retains actual legal identities, formulas, and every native dependency', () => {
    const native = axiomFixture.graph;
    const document = fromAxiomProgramGraph(native);
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    expect([...byId.keys()].sort()).toEqual([...native.rules, ...native.inputs, ...native.relations].map((node) => node.legalId).sort());
    for (const rule of native.rules) {
      expect(byId.get(rule.legalId)?.data?.formula).toEqual(rule.formula);
      expect(byId.get(rule.legalId)?.data?.fileLegalId).toBe(rule.fileLegalId);
      for (const [field, kind] of [['ruleDeps', 'rule_dependency'], ['inputDeps', 'input_dependency'], ['relationDeps', 'relation_dependency']] as const) {
        for (const source of rule[field]) expect(document.edges.some((edge) => edge.source === source && edge.target === rule.legalId && edge.kind === kind)).toBe(true);
      }
    }
    expect(document.nodes.every((node) => node.revision === undefined)).toBe(true);
    expect(axiomExample.revision).toBe(axiomFixture.source.artifactSha256);
    expect(document.receipts).toBeUndefined();
  });

  test('does not promote declared certificates to verified evidence', () => {
    const input = structuredClone(axiomFixture.graph) as AxiomProgramGraph;
    input.rules[0].certificateId = 'declared-certificate';
    input.rules[0].certificationStatus = 'certified';
    const document = fromAxiomProgramGraph(input);
    const node = document.nodes.find((node) => node.id === input.rules[0].legalId)!;
    expect(node.data?.certificateId).toBe('declared-certificate');
    expect(node.statuses?.map((badge) => badge.label)).toContain('Certificate referenced; not verified');
    expect(node.statuses?.some((badge) => badge.tone === 'positive')).toBe(false);
  });

  test('retains unresolved dependencies and stable edge IDs across input ordering', () => {
    const input = structuredClone(axiomFixture.graph) as AxiomProgramGraph;
    const missing = input.inputs.pop()!;
    input.rules[0].inputDeps.push(missing.legalId);
    const first = fromAxiomProgramGraph(input);
    const reversed = fromAxiomProgramGraph({ ...input, rules: [...input.rules].reverse(), inputs: [...input.inputs].reverse() });
    expect(first.nodes.find((node) => node.id === missing.legalId)?.data?.evidenceAvailability).toBe('record_not_supplied');
    expect(first.edges.map((edge) => edge.id).sort()).toEqual(reversed.edges.map((edge) => edge.id).sort());
  });

  test('rejects duplicate IDs and non-JSON payloads', () => {
    const input = structuredClone(axiomFixture.graph);
    input.rules.push(input.rules[0]);
    expect(() => fromAxiomProgramGraph(input)).toThrow('Duplicate');
    const bad = structuredClone(axiomFixture.graph) as AxiomProgramGraph;
    bad.inputs[0].sample = Number.NaN;
    expect(() => fromAxiomProgramGraph(bad)).toThrow('finite JSON');
  });
});

describe('Thesis native record adapter', () => {
  test('matches native record_links output and preserves canonical payloads and IDs', () => {
    const document = fromThesisRecords(thesisFixture.records);
    for (const native of thesisFixture.records) {
      const node = document.nodes.find((node) => node.id === native.id)!;
      expect(node.revision).toBe(native.id);
      expect(node.data?.record as unknown).toEqual(native.payload);
    }
    expect(document.edges.map((edge) => ({ recordId: edge.target, fieldPath: edge.data!.fieldPath, relation: edge.kind, targetId: edge.source, targetKind: document.nodes.find((node) => node.id === edge.source)!.kind }))).toEqual(thesisFixture.nativeLinks);
    expect(document.activities).toEqual([]);
    expect(document.receipts).toBeUndefined();
    expect(thesisExample.metadata?.provenance).toEqual(thesisFixture.source);
  });

  test('retains missing references as unavailable, without inventing observations', () => {
    const observations = thesisFixture.records.filter((record) => record.kind === 'observation');
    const document = fromThesisRecords(observations);
    const missing = document.nodes.filter((node) => node.data?.evidenceAvailability === 'record_not_supplied');
    expect(missing.length).toBe(2);
    expect(missing.every((node) => node.statuses?.[0].tone === 'warning')).toBe(true);
    expect(document.nodes.filter((node) => node.kind === 'observation')).toHaveLength(observations.length);
  });

  test('distinguishes provided task evidence from observed agent consumption', () => {
    // Deliberately synthetic shape test, separate from the native replay example.
    const task: ThesisRecord = { id: 'a'.repeat(64), kind: 'evaluation_task', payload: { kind: 'evaluation_task', target_version_id: 'b'.repeat(64), forecaster_version_id: 'c'.repeat(64), evidence_bundle_id: 'd'.repeat(64) } };
    const document = fromThesisRecords([task]);
    const edge = document.edges.find((edge) => edge.kind === 'evidence_bundle')!;
    expect(edge.data?.evidenceRole).toBe('provided');
    expect(edge.label).toBe('Evidence bundle supplied to task');
    expect(document.activities).toEqual([]);
    expect(document.edges.some((edge) => edge.data?.evidenceRole === 'consumed')).toBe(false);
  });

  test('rejects wrong kinds, unknown schema kinds, and missing declared links', () => {
    const input = structuredClone(thesisFixture.records) as ThesisRecord[];
    input[0].kind = 'observation';
    expect(() => fromThesisRecords(input)).toThrow('mismatch');
    expect(() => fromThesisRecords([{ id: 'a'.repeat(64), kind: 'future_kind', payload: { kind: 'future_kind' } }])).toThrow('Unknown');
    expect(() => fromThesisRecords([{ id: 'a'.repeat(64), kind: 'observation', payload: { kind: 'observation' } }])).toThrow('missing source_series_id');
  });

  test('records explicit artifact references without alleging available or verified bytes', () => {
    const document = fromThesisRecords(thesisFixture.records);
    expect(document.artifacts!.length).toBeGreaterThan(0);
    expect(document.artifacts!.every((artifact) => artifact.sha256 === artifact.id && artifact.uri === undefined)).toBe(true);
    expect(document.metadata?.artifactAvailability).toBe('references_only');
    expect(document.nodes.every((node) => !node.statuses?.some((badge) => badge.tone === 'positive'))).toBe(true);
  });
});
