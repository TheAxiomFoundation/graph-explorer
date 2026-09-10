import { describe, expect, test } from 'bun:test';
import {
  decodeLocation, encodeLocation, getDefaultLineageLocation, parseGraphDocument,
  prepareGraphExport, traceLineage, validateGraphDocument,
  type GraphDocument,
} from '../src/core/index.js';

const fixture = (): GraphDocument => ({
  schemaVersion: 'graph-explorer/v1', id: 'invented-lineage', title: 'Invented measurement pipeline',
  nodes: ['raw', 'before', 'adjustment', 'transform', 'output', 'mask', 'weight', 'operator', 'context-input', 'further-context', 'sibling', 'unannotated'].map(id => ({ id, label: id, kind: 'invented', revision: 'r1' })),
  edges: [
    { id: 'read', source: 'raw', target: 'before', kind: 'read_value' },
    { id: 'transform-input', source: 'before', target: 'transform', kind: 'left_operand' },
    { id: 'parallel', source: 'before', target: 'transform', kind: 'comparison_operand' },
    { id: 'adjust', source: 'adjustment', target: 'transform', kind: 'right_operand' },
    { id: 'write', source: 'transform', target: 'output', kind: 'write_value' },
    { id: 'mask-transform', source: 'mask', target: 'transform', kind: 'selection_mask' },
    { id: 'weight-mask', source: 'weight', target: 'mask', kind: 'mask_weight' },
    { id: 'operator-transform', source: 'operator', target: 'transform', kind: 'implemented_by' },
    { id: 'operator-further', source: 'operator', target: 'further-context', kind: 'documented_by' },
    { id: 'context-input', source: 'context-input', target: 'operator', kind: 'operator_configuration' },
    { id: 'sibling', source: 'before', target: 'sibling', kind: 'consumed_elsewhere' },
    // Meaning/category alone never admit an unannotated edge into precise lineage.
    { id: 'unannotated', source: 'unannotated', target: 'output', kind: 'value', category: 'dependency' },
  ],
  lineage: {
    schemaVersion: 'orrery-lineage/v1',
    variables: [
      { id: 'measurement', label: 'Measurement', stages: [{ id: 'before', label: 'Input stage', nodeId: 'before' }, { id: 'after', label: 'Output stage', nodeId: 'output' }] },
      { id: 'alias', label: 'Same output, alternate entry', stages: [{ id: 'after', label: 'Output', nodeId: 'output' }] },
    ],
    relations: [
      ...['read', 'transform-input', 'parallel', 'adjust', 'write', 'weight-mask', 'context-input', 'sibling'].map(edgeId => ({ edgeId, role: 'value' as const })),
      { edgeId: 'mask-transform', role: 'control' },
      ...['operator-transform', 'operator-further'].map(edgeId => ({ edgeId, role: 'context' as const })),
    ],
    boundaries: ['raw', 'adjustment', 'weight', 'operator'].map(nodeId => ({ nodeId, kind: 'source' as const, description: 'Declared input; no completeness or verification claim.' })),
  },
});

describe('explicit variable lineage', () => {
  test('traces exact value edges, preserving parallel meanings and excluding sibling consumers', () => {
    const graph = parseGraphDocument(fixture());
    const original = JSON.stringify(graph);
    const trace = traceLineage(graph, 'output');
    expect(trace).toEqual({
      validRoot: true,
      nodeIds: ['raw', 'before', 'adjustment', 'transform', 'output'],
      edgeIds: ['read', 'transform-input', 'parallel', 'adjust', 'write'],
      boundaries: graph.lineage!.boundaries.filter(boundary => ['raw', 'adjustment'].includes(boundary.nodeId)).map(boundary => ({ ...boundary, declared: true })),
      cycles: [], excludedControlEdgeIds: ['mask-transform'], contextEdgeIds: [],
    });
    expect(JSON.stringify(graph)).toBe(original);
    expect('complete' in trace).toBe(false);
  });

  test('controls recursively include their own value inputs without admitting unannotated edges', () => {
    const trace = traceLineage(fixture(), 'output', { includeControls: true });
    expect(trace.nodeIds).toEqual(['raw', 'before', 'adjustment', 'transform', 'output', 'mask', 'weight']);
    expect(trace.edgeIds).toEqual(['read', 'transform-input', 'parallel', 'adjust', 'write', 'mask-transform', 'weight-mask']);
    expect(trace.boundaries.map(boundary => boundary.nodeId)).toEqual(['raw', 'adjustment', 'weight']);
    expect(trace.excludedControlEdgeIds).toEqual([]);
  });

  test('context adds only incident context edges and cannot manufacture source coverage', () => {
    const graph = fixture();
    // It is deliberately annotated as a source, but enters only as context.
    const trace = traceLineage(graph, 'output', { includeContext: true });
    expect(trace.nodeIds).toEqual(['raw', 'before', 'adjustment', 'transform', 'output', 'operator']);
    expect(trace.contextEdgeIds).toEqual(['operator-transform']);
    expect(trace.edgeIds).not.toContain('operator-further');
    expect(trace.edgeIds).not.toContain('context-input');
    expect(trace.boundaries.map(boundary => boundary.nodeId)).toEqual(['raw', 'adjustment']);
    expect(trace.cycles).toEqual([]);
    graph.edges.push({ id: 'outgoing-context', source: 'output', target: 'further-context', kind: 'explanation' });
    graph.lineage!.relations.push({ edgeId: 'outgoing-context', role: 'context' });
    expect(traceLineage(graph, 'output', { includeContext: true }).contextEdgeIds).toEqual(['operator-transform', 'outgoing-context']);
  });

  test('explicit source and unknown boundaries stop all recursive input traversal', () => {
    for (const kind of ['source', 'unknown'] as const) {
      const graph = fixture();
      graph.lineage!.boundaries.push({ nodeId: 'transform', kind, description: 'The host stops the trace here.' });
      const trace = traceLineage(graph, 'output', { includeControls: true });
      expect(trace.nodeIds).toEqual(['transform', 'output']);
      expect(trace.edgeIds).toEqual(['write']);
      expect(trace.boundaries).toEqual([{ nodeId: 'transform', kind, description: 'The host stops the trace here.', declared: true }]);
      expect(trace.cycles).toEqual([]);
    }
  });

  test('missing terminal annotations are reported as implicit unknowns', () => {
    const graph = fixture();
    graph.lineage!.boundaries = graph.lineage!.boundaries.filter(boundary => boundary.nodeId !== 'raw');
    const trace = traceLineage(graph, 'output');
    expect(trace.boundaries[0]).toMatchObject({ nodeId: 'raw', kind: 'unknown', declared: false });
    expect(trace.boundaries[0]!.description).toContain('no source or unknown boundary');
    const input = traceLineage(graph, 'unannotated');
    expect(input.validRoot).toBe(true);
    expect(input.nodeIds).toEqual(['unannotated']);
    expect(input.boundaries[0]).toMatchObject({ nodeId: 'unannotated', kind: 'unknown', declared: false });
  });

  test('pure cycles, self loops and cycles with a source stay explicit and terminate', () => {
    const graph: GraphDocument = {
      schemaVersion: 'graph-explorer/v1', id: 'cycle', title: 'Invented feedback',
      nodes: ['source', 'a', 'b', 'self', 'output'].map(id => ({ id, label: id, kind: 'record' })),
      edges: [
        { id: 'ab', source: 'a', target: 'b', kind: 'value' }, { id: 'ba', source: 'b', target: 'a', kind: 'value' },
        { id: 'ss', source: 'self', target: 'self', kind: 'value' }, { id: 'out', source: 'a', target: 'output', kind: 'value' },
        { id: 'self-out', source: 'self', target: 'output', kind: 'value' },
      ],
      lineage: { schemaVersion: 'orrery-lineage/v1', variables: [{ id: 'feedback', label: 'Feedback', stages: [{ id: 'result', label: 'Result', nodeId: 'output' }] }], relations: [], boundaries: [] },
    };
    graph.lineage!.relations = graph.edges.map(edge => ({ edgeId: edge.id, role: 'value' }));
    expect(traceLineage(parseGraphDocument(graph), 'output')).toMatchObject({ cycles: [['a', 'b'], ['self']], boundaries: [], validRoot: true });
    graph.edges.push({ id: 'source-a', source: 'source', target: 'a', kind: 'initial_value' });
    graph.lineage!.relations.push({ edgeId: 'source-a', role: 'value' });
    graph.lineage!.boundaries.push({ nodeId: 'source', kind: 'source', description: 'Declared initial state.' });
    const trace = traceLineage(graph, 'output');
    expect(trace.cycles).toEqual([['a', 'b'], ['self']]);
    expect(trace.boundaries).toEqual([{ nodeId: 'source', kind: 'source', description: 'Declared initial state.', declared: true }]);
    graph.lineage!.boundaries.push({ nodeId: 'a', kind: 'unknown', description: 'Feedback not expanded.' });
    expect(traceLineage(graph, 'output').cycles).toEqual([['self']]);
  });

  test('deep chains avoid recursive traversal and SCC stack limits', () => {
    const count = 12_000;
    const graph: GraphDocument = {
      schemaVersion: 'graph-explorer/v1', id: 'long', title: 'Invented long chain',
      nodes: Array.from({ length: count }, (_, i) => ({ id: String(i), label: String(i), kind: 'record' })),
      edges: Array.from({ length: count - 1 }, (_, i) => ({ id: String(i), source: String(i), target: String(i + 1), kind: 'input' })),
      lineage: { schemaVersion: 'orrery-lineage/v1', variables: [{ id: 'chain', label: 'Chain', stages: [{ id: 'result', label: 'Result', nodeId: String(count - 1) }] }], relations: [], boundaries: [{ nodeId: '0', kind: 'source', description: 'Declared input.' }] },
    };
    graph.lineage!.relations = graph.edges.map(edge => ({ edgeId: edge.id, role: 'value' }));
    const trace = traceLineage(graph, String(count - 1));
    expect(trace.nodeIds).toHaveLength(count);
    expect(trace.edgeIds).toHaveLength(count - 1);
    expect(trace.cycles).toEqual([]);
    expect(trace.boundaries).toHaveLength(1);
  });

  test('annotation order does not change native ordering or the selected edge set', () => {
    const graph = fixture();
    const before = traceLineage(graph, 'output', { includeControls: true, includeContext: true });
    graph.lineage!.relations.reverse(); graph.lineage!.boundaries.reverse();
    expect(traceLineage(graph, 'output', { includeControls: true, includeContext: true })).toEqual(before);
  });

  test('missing annotations and missing roots fail explicitly, with no whole-graph fallback', () => {
    const graph = fixture();
    expect(traceLineage(graph, 'missing')).toEqual({ validRoot: false, nodeIds: [], edgeIds: [], boundaries: [], cycles: [], excludedControlEdgeIds: [], contextEdgeIds: [] });
    delete graph.lineage;
    expect(parseGraphDocument(graph).lineage).toBeUndefined();
    expect(traceLineage(graph, 'output').validRoot).toBe(false);
    expect(getDefaultLineageLocation(graph)).toBeUndefined();
  });

  test('default entry uses authored order while shared stage nodes and separate selection survive URLs', () => {
    const graph = parseGraphDocument(fixture());
    expect(getDefaultLineageLocation(graph)).toEqual({ traceId: 'output', traceVariableId: 'measurement', selectedId: 'output', selectedType: 'node' });
    graph.lineage!.variables[0]!.stages.reverse();
    expect(getDefaultLineageLocation(graph)!.traceId).toBe('before');
    const location = { ...getDefaultLineageLocation(graph)!, traceId: 'node/#?税', traceVariableId: 'variable&/#', traceControls: true, traceContext: false, selectedId: 'independent/selection', selectedType: 'edge' as const, query: 'retained search', depth: 3 };
    expect(decodeLocation(encodeLocation(location))).toEqual(location);
    expect(decodeLocation('#traceControls=1&traceContext=nonsense')).toEqual({});
    graph.lineage!.variables = [];
    expect(getDefaultLineageLocation(graph)).toBeUndefined();
  });
});

describe('lineage annotation and export validation', () => {
  const invalidPatches: [string, (graph: any) => void][] = [
    ['null annotation', graph => { graph.lineage = null; }],
    ['unsupported schema', graph => { graph.lineage.schemaVersion = 'next'; }],
    ['missing variables', graph => { delete graph.lineage.variables; }],
    ['empty variables', graph => { graph.lineage.variables = []; }],
    ['missing relations', graph => { delete graph.lineage.relations; }],
    ['missing boundaries', graph => { delete graph.lineage.boundaries; }],
    ['duplicate variables', graph => { graph.lineage.variables.push(graph.lineage.variables[0]); }],
    ['empty stages', graph => { graph.lineage.variables[0].stages = []; }],
    ['duplicate stage ID', graph => { graph.lineage.variables[0].stages.push(graph.lineage.variables[0].stages[0]); }],
    ['ambiguous stage node', graph => { graph.lineage.variables[0].stages.push({ id: 'another-output', label: 'Other output label', nodeId: 'output' }); }],
    ['empty stage label', graph => { graph.lineage.variables[0].stages[0].label = ' '; }],
    ['numeric node reference', graph => { graph.nodes.push({ id: '42', label: '42', kind: 'record' }); graph.lineage.variables[0].stages[0].nodeId = 42; }],
    ['unknown stage node', graph => { graph.lineage.variables[0].stages[0].nodeId = 'missing'; }],
    ['unknown edge', graph => { graph.lineage.relations[0].edgeId = 'missing'; }],
    ['conflicting role', graph => { graph.lineage.relations.push({ edgeId: 'read', role: 'control' }); }],
    ['coerced role', graph => { graph.lineage.relations[0].role = ['value']; }],
    ['unknown boundary', graph => { graph.lineage.boundaries[0].nodeId = 'missing'; }],
    ['conflicting boundary', graph => { graph.lineage.boundaries.push({ nodeId: 'raw', kind: 'unknown', description: 'Conflict' }); }],
    ['coerced boundary kind', graph => { graph.lineage.boundaries[0].kind = ['source']; }],
    ['missing boundary explanation', graph => { delete graph.lineage.boundaries[0].description; }],
  ];
  for (const [name, patch] of invalidPatches) test(`rejects ${name}`, () => {
    const graph = fixture(); patch(graph);
    const validation = validateGraphDocument(graph);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some(issue => issue.path.startsWith('$.lineage'))).toBe(true);
    expect(() => parseGraphDocument(graph)).toThrow();
  });

  test('exports retain exact annotations and detach them without inheriting assessments', () => {
    const graph = fixture();
    const exported = prepareGraphExport({ ...graph, assessments: [{ status: 'verified' }], command: 'never execute' });
    expect(exported.document.lineage).toEqual(graph.lineage);
    expect(JSON.parse(exported.json).lineage).toEqual(graph.lineage);
    expect('assessments' in exported.document).toBe(false);
    expect('command' in exported.document).toBe(false);
    graph.lineage!.variables[0]!.label = 'Changed after export';
    expect(exported.document.lineage!.variables[0]!.label).toBe('Measurement');
  });

  test('projecting away annotated nodes or edges fails rather than silently repairing lineage', () => {
    const graph = fixture();
    graph.edges = graph.edges.filter(edge => edge.id !== 'parallel');
    expect(() => prepareGraphExport(graph)).toThrow(/Unknown lineage edge/);
    graph.lineage!.relations = graph.lineage!.relations.filter(relation => relation.edgeId !== 'parallel');
    expect(() => prepareGraphExport(graph)).not.toThrow();
    const removed = fixture();
    removed.nodes = removed.nodes.filter(node => node.id !== 'raw');
    removed.edges = removed.edges.filter(edge => edge.source !== 'raw' && edge.target !== 'raw');
    removed.lineage!.relations = removed.lineage!.relations.filter(relation => relation.edgeId !== 'read');
    expect(() => prepareGraphExport(removed)).toThrow(/Unknown lineage node/);
    removed.lineage!.boundaries = removed.lineage!.boundaries.filter(boundary => boundary.nodeId !== 'raw');
    expect(() => prepareGraphExport(removed)).not.toThrow();
    expect(traceLineage(removed, 'output').boundaries).toContainEqual(expect.objectContaining({ nodeId: 'before', kind: 'unknown', declared: false }));
  });
});
