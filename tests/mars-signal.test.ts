import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { diffGraphs, parseGraphDocument, traverse } from '../src/core/index.js';
import { marsSignalArtifacts, marsSignalExamples } from '../examples/mars-signal';
import execution from '../examples/mars-axiom-run.json';
import checks from '../examples/mars-signal-checks.json';

describe('recorded Mars signal example', () => {
  test('the answer uses actual native decimal outputs and rounds only their presentation', () => {
    expect(marsSignalExamples.map(example => example.spotlight.answer)).toEqual(['15 min 4 sec', '5 min 21 sec']);
    for (const example of marsSignalExamples) {
      const graph = example.document;
      expect(parseGraphDocument(graph)).toEqual(graph);
      const run = execution.runs.find(run => run.epoch === graph.metadata!.modeledEpoch)!;
      const answer = graph.nodes.find(node => node.id === 'mars-signal/answer')!;
      expect(answer.data!.seconds).toBe(run.seconds);
      expect(answer.data!.minutes).toBe(run.minutes);
      expect(graph.nodes.find(node => node.id === 'mars-signal/distance')!.data!.kilometers).toBe(run.inputRangeKm);
      const calculation = graph.nodes.find(node => node.id === 'mars-signal/calculation')!;
      expect(calculation.data!.nativeRequest).toEqual(run.request);
      expect(calculation.data!.nativeResponse).toEqual(run.response);
      expect(calculation.data!.nativeOutputId).toBe(execution.moduleTarget + '#fixed_position_one_way_seconds');
      expect(graph.receipts).toEqual([]);
      expect(graph.metadata!.receiptAvailability).toBe('not_provided');
      expect(example.caveat).toContain('holding positions fixed');
      expect(example.spotlight.scope).toContain('One-way');
      expect(example.spotlight.dateLabel).toContain('00:00 UTC');
    }
  });

  test('date comparison keeps stable identities and edges while source, calculation and answer revisions change', () => {
    const [current, earlier] = marsSignalExamples;
    expect(current.baseline).toBe(earlier.document);
    expect(current.document.nodes).toHaveLength(10);
    expect(current.document.edges).toHaveLength(11);
    expect(current.document.nodes.map(node => node.id)).toEqual(earlier.document.nodes.map(node => node.id));
    expect(current.document.edges).toEqual(earlier.document.edges);
    const diff = diffGraphs(earlier.document, current.document);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.changed).toEqual(['mars-signal/epoch', 'mars-signal/horizons', 'mars-signal/distance', 'mars-signal/calculation', 'mars-signal/answer', 'mars-signal/check']);
    for (const node of current.document.nodes) {
      const prior = earlier.document.nodes.find(prior => prior.id === node.id)!;
      if (node.revision === prior.revision) expect(node).toEqual(prior);
    }
    for (const activity of current.document.activities!) {
      const prior = earlier.document.activities!.find(prior => prior.id === activity.id)!;
      if (activity.revision === prior.revision) expect(activity).toEqual(prior);
    }
    expect(current.document.metadata!.comparisonMeaning).toContain('no earlier publication implied');
  });

  test('every guide resolves and real source, computation and check paths reach the result', () => {
    for (const { document, guide, location } of marsSignalExamples) {
      expect(traverse(document, 'mars-signal/horizons', 'downstream').has('mars-signal/answer')).toBe(true);
      expect(traverse(document, 'mars-signal/light-speed', 'downstream').has('mars-signal/answer')).toBe(true);
      expect(traverse(document, location.focusId!, 'both', { maxDepth: location.depth }).size).toBe(10);
      for (const stop of guide) {
        expect(document.nodes.some(node => node.id === stop.selectedId)).toBe(true);
        expect(document.nodes.some(node => node.id === stop.focusId)).toBe(true);
      }
      const activity = document.activities!.find(activity => activity.kind === 'execution')!;
      const run = execution.runs.find(run => run.epoch === document.metadata!.modeledEpoch)!;
      expect(activity.startedAt).toBe(run.startedAt);
      expect(activity.endedAt).toBe(run.endedAt);
      expect(activity.artifactIds).toContain(run.responseArtifact.sha256);
      expect(activity.agent!.version).toBe(execution.runtime.capabilities.engine.version);
      const check = document.nodes.find(node => node.id === 'mars-signal/check')!;
      expect(check.data!.status).toBe('passed');
      expect(check.data!.scope).toBe(checks.scope);
    }
  });

  test('every published artifact and immutable source link binds exact allowed public bytes', () => {
    const hashes = new Set<string>();
    for (const artifact of marsSignalArtifacts) {
      expect(artifact.sourcePath).toMatch(/^examples\/mars-(signal|axiom)[^]*$/);
      const bytes = readFileSync(new URL(`../${artifact.sourcePath}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
      expect(bytes.byteLength).toBe(artifact.byteLength);
      expect(hashes.has(artifact.sha256)).toBe(false);
      hashes.add(artifact.sha256);
    }
    for (const { document } of marsSignalExamples) {
      expect(document.artifacts).toHaveLength(marsSignalArtifacts.length);
      for (const artifact of document.artifacts!) {
        const captured = marsSignalArtifacts.find(item => item.sha256 === artifact.sha256)!;
        expect(artifact.uri).toBe(`https://theaxiomfoundation.github.io/orrery/artifacts/mars/${artifact.sha256}.${captured.extension}`);
      }
      for (const source of document.nodes.flatMap(node => node.sources ?? []).filter(source => source.sha256)) {
        expect(hashes.has(source.sha256!)).toBe(true);
        expect(source.url).toContain(`/artifacts/mars/${source.sha256}.`);
      }
      expect(JSON.stringify(document)).not.toContain('/Users/');
      expect(JSON.stringify(document)).not.toContain('/private/');
    }
  });
});
