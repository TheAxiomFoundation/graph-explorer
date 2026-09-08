import { describe, expect, test } from 'bun:test';
import { prepareGraphExport, stableJson } from '../src/core/index.js';
import type { GraphDocument } from '../src/core/types.js';

const snapshot = (): GraphDocument => ({
  schemaVersion: 'graph-explorer/v1', id: 'source-snapshot', title: 'Host graph',
  nodes: [
    { id: 'public', label: 'Public record', kind: 'record', revision: 'rev-1', data: { fields: { public: 'retained', internal: 'host must omit explicitly' } } },
    { id: 'internal', label: 'Internal record', kind: 'record', data: { unpublished: 'not exported' } },
  ],
  edges: [{ id: 'reference', source: 'internal', target: 'public', kind: 'reference' }],
  metadata: { internalContext: 'not exported' },
});

describe('explicit host export projection', () => {
  test('exports exactly the host-supplied subset without recovering omitted data', () => {
    const original = snapshot();
    const before = structuredClone(original);
    const projected: GraphDocument = {
      schemaVersion: original.schemaVersion, id: 'public-projection', title: original.title,
      nodes: [{ id: 'public', label: original.nodes[0].label, kind: 'record', revision: 'rev-1', data: { fields: { public: 'retained' } } }],
      edges: [], metadata: { projection: 'Explicit public fields selected by host' },
    };
    const result = prepareGraphExport(projected);
    expect(JSON.parse(result.json)).toEqual(projected);
    expect(result.json).not.toContain('internal');
    expect(result.json).not.toContain('unpublished');
    expect(result.document.nodes.map(node => node.id)).toEqual(['public']);
    expect(original).toEqual(before);
  });

  test('clones retained nested records and leaves the input untouched in both directions', () => {
    const projected = snapshot();
    const before = structuredClone(projected);
    const result = prepareGraphExport(projected);
    expect(projected).toEqual(before);
    expect(result.document.nodes).not.toBe(projected.nodes);
    expect(result.document.nodes[0].data).not.toBe(projected.nodes[0].data);
    (result.document.nodes[0].data!.fields as Record<string, string>).public = 'changed result';
    expect((projected.nodes[0].data!.fields as Record<string, string>).public).toBe('retained');
    projected.nodes[1].label = 'changed input';
    expect(result.document.nodes[1].label).toBe('Internal record');
    expect(JSON.parse(result.json)).toEqual(before);
  });

  test('uses deterministic key ordering, preserves array order, and ends in one newline', () => {
    const first = snapshot(), second = snapshot();
    first.nodes[0].data = { z: 3, a: { y: 2, x: 1 } };
    second.nodes[0].data = { a: { x: 1, y: 2 }, z: 3 };
    const left = prepareGraphExport(first), right = prepareGraphExport(second);
    expect(left.json).toBe(right.json);
    expect(left.json).toBe(`${stableJson(left.document)}\n`);
    expect(left.json.endsWith('\n\n')).toBe(false);
    expect(left.document.nodes.map(node => node.id)).toEqual(['public', 'internal']);
  });

  test('strips top-level verification results and executable configuration', () => {
    const projected = { ...snapshot(), assessments: [{ status: 'verified' }], verifierConfig: { command: 'do not execute' }, trustAnchors: ['not-authority'] };
    const result = prepareGraphExport(projected);
    const decoded = JSON.parse(result.json);
    for (const key of ['assessments', 'verifierConfig', 'trustAnchors']) {
      expect(Object.hasOwn(result.document, key)).toBe(false);
      expect(Object.hasOwn(decoded, key)).toBe(false);
    }
    expect(projected.assessments).toEqual([{ status: 'verified' }]);
  });

  test('refuses missing input instead of choosing an implicit source', () => {
    expect(() => prepareGraphExport(undefined)).toThrow('Expected a graph object');
    expect(() => prepareGraphExport(null)).toThrow('Expected a graph object');
    expect(() => prepareGraphExport({})).toThrow();
  });

  test('refuses dangling edges and parent references after host projection', () => {
    const edge = snapshot(); edge.nodes = [edge.nodes[0]];
    expect(() => prepareGraphExport(edge)).toThrow('Unknown source node');
    const parent = snapshot(); parent.nodes[0].parentId = 'omitted-parent';
    expect(() => prepareGraphExport(parent)).toThrow('Unknown parent node');
  });

  test('refuses dangling activity, artifact, and receipt references without pruning them', () => {
    const activity = snapshot();
    activity.activities = [{ id: 'execution', label: 'Recorded execution', kind: 'execution', outputs: [{ type: 'node', id: 'omitted-output' }] }];
    expect(() => prepareGraphExport(activity)).toThrow('Unknown subject');
    const artifact = snapshot();
    artifact.activities = [{ id: 'execution', label: 'Recorded execution', kind: 'execution', artifactIds: ['omitted-artifact'] }];
    expect(() => prepareGraphExport(artifact)).toThrow('Unknown artifact');
    const receipt = snapshot();
    receipt.receipts = [{ id: 'proof', label: 'Referenced receipt', subjects: [{ type: 'activity', id: 'omitted-execution' }] }];
    expect(() => prepareGraphExport(receipt)).toThrow('Unknown subject');
  });

  test('preserves exact integer tags and refuses already-rounded numeric values', () => {
    const projected = snapshot();
    projected.nodes[0].data = { seed: { integer_literal: '18446744073709551615' }, signed: { integer_literal: '-9223372036854775808' } };
    const result = prepareGraphExport(projected);
    expect(result.document.nodes[0].data).toEqual(projected.nodes[0].data);
    expect(JSON.parse(result.json).nodes[0].data.seed.integer_literal).toBe('18446744073709551615');
    projected.nodes[0].data = { seed: 18446744073709551615 };
    expect(() => prepareGraphExport(projected)).toThrow('Unsafe integer');
  });
});
