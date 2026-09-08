import { describe, expect, test } from 'bun:test';
import { parseGraphDocument } from '../src/core/index.js';
import { thesisWalkthrough as graph, thesisWalkthroughBaseline as baseline, thesisWalkthroughSteps } from '../examples/thesis-walkthrough.js';
import publication from '../examples/thesis-walkthrough-publication.json';

describe('the published native Thesis walkthrough', () => {
  test('preserves native identities and original distributions across both attempts', () => {
    expect(parseGraphDocument(graph)).toEqual(graph);
    for (const detail of publication.details) {
      const run = graph.nodes.find(n => n.id === detail.id)!;
      const dispatchArtifact = detail.artifacts.find(a => a.role === 'attempt')!;
      expect(run).toBeDefined();
      expect(run.id).not.toBe(dispatchArtifact.sha256);
      expect(run.data!.observedModel).toBeNull();
      for (const arm of detail.response.arms) {
        const node = graph.nodes.find(n => n.id === JSON.stringify([detail.id, 'arm', arm.id]))!;
        expect(node.data!.distribution).toEqual(arm.distribution);
        expect((node.data!.distribution as { points: unknown[] }).points).toHaveLength(201);
      }
    }
  });

  test('the original-only comparison preserves immutable records without inventing an earlier publication', () => {
    for (const node of baseline.nodes) expect(graph.nodes.find(n => n.id === node.id)).toEqual(node);
    for (const edge of baseline.edges) expect(graph.edges.find(e => e.id === edge.id)).toEqual(edge);
    expect(baseline.metadata!.snapshotMeaning).toContain('not a claim of earlier publication');
    const revisions = graph.nodes.filter(n => n.kind === 'revision_association');
    expect(revisions).toHaveLength(1);
    expect(revisions[0].data!.record).toMatchObject({ association_basis: 'retrospective_association', linked_at: '2026-09-07T18:35:43.321188Z' });
  });

  test('source provision, model execution, review and absent Receipt stay distinct', () => {
    expect(graph.receipts).toEqual([]);
    expect(graph.metadata!.receiptAvailability).toBe('not_provided');
    expect(graph.nodes.filter(n => n.kind === 'source_review').map(n => (n.data!.record as { outcome: string }).outcome)).toEqual(['issues_remaining', 'issues_remaining']);
    expect(graph.activities!.filter(a => a.kind === 'execution')).toHaveLength(2);
    expect(graph.activities!.filter(a => a.kind === 'review')).toHaveLength(2);
    expect(graph.activities!.flatMap(a => a.inputs ?? []).some(input => input.role === 'consumed')).toBe(false);
    expect(graph.artifacts!.some(a => a.id === publication.details[1].shared_evidence_id)).toBe(false);
    expect(graph.nodes.some(n => n.label.includes('Revised review · 3 findings'))).toBe(true);
  });

  test('public facts connect to a recorded result and every guided stop resolves', () => {
    const source = graph.nodes.find(n => n.kind === 'public_source' && n.data!.nativeSourceId === 'naep-history')!;
    const target = thesisWalkthroughSteps[1].selectedId;
    const visited = new Set([source.id]);
    for (let i = 0; i < graph.nodes.length; i++) for (const edge of graph.edges) if (visited.has(edge.source)) visited.add(edge.target);
    expect(visited.has(target)).toBe(true);
    expect(graph.nodes.filter(n => n.kind === 'historical_observation')).toHaveLength(11);
    for (const step of thesisWalkthroughSteps) {
      expect(graph.nodes.some(n => n.id === step.selectedId)).toBe(true);
      expect(graph.nodes.some(n => n.id === step.focusId)).toBe(true);
    }
  });

  test('artifact links point to the exact allowed public commit, without local paths', () => {
    for (const artifact of graph.artifacts!) {
      expect(artifact.uri).toBe(`https://raw.githubusercontent.com/ThesisInstitute/thesis/${publication.source.commit}/site/lab-publication/blobs/${artifact.sha256}`);
    }
    expect(JSON.stringify(graph)).not.toContain('/Users/');
    expect(JSON.stringify(graph)).not.toContain('architecture-reviews');
    expect(publication.source.checkedArtifactCount).toBe(34);
  });
});
