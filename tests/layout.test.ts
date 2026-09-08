import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import dagre from '@dagrejs/dagre';
import { layoutNodePositions } from '../src/react/layout.js';
import type { LayoutEdge, LayoutNode, LayoutPosition } from '../src/react/layout.js';

// Reviewed minimal reproduction: generic IDs and dimensions only, copied from
// the host's anonymized five-node/six-edge geometry. No host graph is imported.
const minimalNodes: LayoutNode[] = ['n0', 'n1', 'n2', 'n3', 'n4'].map(id => ({ id, width: 310, height: 202 }));
const minimalEdges: LayoutEdge[] = [
  { id: 'e0', source: 'n3', target: 'n1' },
  { id: 'e1', source: 'n1', target: 'n3' },
  { id: 'e2', source: 'n0', target: 'n1' },
  { id: 'e3', source: 'n0', target: 'n2' },
  { id: 'e4', source: 'n1', target: 'n3' },
  { id: 'e5', source: 'n2', target: 'n4' },
];
const simpleNodes = [
  { id: 'input', width: 248, height: 126 },
  { id: 'work', width: 310, height: 202 },
  { id: 'output', width: 280, height: 160 },
];
const simpleEdges = [
  { id: 'input-work', source: 'input', target: 'work' },
  { id: 'work-output', source: 'work', target: 'output' },
];
const originalLayout = dagre.layout;
let layoutSpy: ReturnType<typeof spyOn<typeof dagre, 'layout'>> | undefined;
afterEach(() => { layoutSpy?.mockRestore(); layoutSpy = undefined; });

function legacyGraph(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]) {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', ranksep: 116, nodesep: 40, edgesep: 24, marginx: 32, marginy: 32 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const { id, width, height } of nodes) graph.setNode(id, { width, height });
  for (const { id, source, target } of edges) graph.setEdge(source, target, {}, id);
  return graph;
}

function expectFinitePositions(positions: Map<string, LayoutPosition>, nodes: readonly LayoutNode[]) {
  expect([...positions.keys()]).toEqual(nodes.map(node => node.id));
  for (const node of nodes) {
    const position = positions.get(node.id)!;
    expect(Number.isFinite(position.x)).toBe(true);
    expect(Number.isFinite(position.y)).toBe(true);
    expect(position.width).toBe(node.width);
    expect(position.height).toBe(node.height);
  }
}

describe('Dagre positioning', () => {
  test('successful ordinary layouts preserve the exact previous Dagre positions and dimensions', () => {
    const graph = legacyGraph(simpleNodes, simpleEdges);
    originalLayout(graph);
    layoutSpy = spyOn(dagre, 'layout');
    const positions = layoutNodePositions(simpleNodes, simpleEdges);
    expect(layoutSpy).toHaveBeenCalledTimes(1);
    for (const node of simpleNodes) {
      const { x, y, width, height } = graph.node(node.id);
      expect(positions.get(node.id)).toEqual({ x, y, width, height });
    }
    expect(positions.get('input')!.x).toBeLessThan(positions.get('work')!.x);
    expect(positions.get('work')!.x).toBeLessThan(positions.get('output')!.x);
  });

  test('the real pinned ordering defect recovers with native custom and default node sizes', () => {
    for (const nodes of [minimalNodes, minimalNodes.map(node => ({ ...node, width: 248, height: 126 }))]) {
      expect(() => originalLayout(legacyGraph(nodes, minimalEdges))).toThrow('Not possible to find intersection inside of the rectangle');
      expectFinitePositions(layoutNodePositions(nodes, minimalEdges), nodes);
      expect(layoutNodePositions(nodes, minimalEdges)).toEqual(layoutNodePositions(nodes, minimalEdges));
    }
  });

  test('retry uses a fresh graph and keeps both directions and every parallel edge', () => {
    const calls: { graph: ReturnType<typeof legacyGraph>; disabled: boolean }[] = [];
    layoutSpy = spyOn(dagre, 'layout').mockImplementation((graph, options) => {
      calls.push({ graph, disabled: options?.disableOptimalOrderHeuristic === true });
      expect(graph.nodes()).toEqual(minimalNodes.map(node => node.id));
      expect(graph.edges().map(edge => ({ id: edge.name, source: edge.v, target: edge.w }))).toEqual(minimalEdges);
      return originalLayout(graph, options);
    });
    expectFinitePositions(layoutNodePositions(minimalNodes, minimalEdges), minimalNodes);
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.disabled)).toEqual([false, true]);
    expect(calls[0].graph).not.toBe(calls[1].graph);
  });

  test('cycles, parallel self-loops, and disconnected nodes retain their geometry and identity', () => {
    const nodes = [...simpleNodes, { id: 'disconnected', width: 190, height: 90 }];
    const edges = [...simpleEdges,
      { id: 'cycle', source: 'output', target: 'input' },
      { id: 'parallel', source: 'input', target: 'work' },
      { id: 'self-a', source: 'work', target: 'work' },
      { id: 'self-b', source: 'work', target: 'work' },
    ];
    layoutSpy = spyOn(dagre, 'layout').mockImplementation((graph, options) => {
      expect(graph.edgeCount()).toBe(edges.length);
      for (const edge of edges) expect(graph.hasEdge(edge.source, edge.target, edge.id)).toBe(true);
      return originalLayout(graph, options);
    });
    expectFinitePositions(layoutNodePositions(nodes, edges), nodes);
  });

  test('retry also repairs nonfinite returned node or edge geometry', () => {
    for (const corrupt of [
      (graph: ReturnType<typeof legacyGraph>) => { graph.node('work').x = NaN; },
      (graph: ReturnType<typeof legacyGraph>) => { graph.edge('input', 'work', 'input-work').points[0].y = Infinity; },
    ]) {
      let calls = 0;
      layoutSpy = spyOn(dagre, 'layout').mockImplementation((graph, options) => {
        originalLayout(graph, options);
        if (++calls === 1) corrupt(graph);
        return graph;
      });
      expectFinitePositions(layoutNodePositions(simpleNodes, simpleEdges), simpleNodes);
      expect(calls).toBe(2);
      layoutSpy.mockRestore();
      layoutSpy = undefined;
    }
  });

  test('a failed retry reports failure rather than returning a partial or fabricated layout', () => {
    layoutSpy = spyOn(dagre, 'layout').mockImplementation(() => {
      throw new Error('Not possible to find intersection inside of the rectangle');
    });
    let failure: unknown;
    try { layoutNodePositions(minimalNodes, minimalEdges); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('failed after retrying');
    const cause = (failure as Error).cause as AggregateError;
    expect(cause).toBeInstanceOf(AggregateError);
    expect(cause.errors).toHaveLength(2);
    expect(layoutSpy).toHaveBeenCalledTimes(2);
  });

  test('unexpected engine failures propagate without being disguised as the known ordering bug', () => {
    const failure = new Error('Unexpected engine failure');
    layoutSpy = spyOn(dagre, 'layout').mockImplementation(() => { throw failure; });
    expect(() => layoutNodePositions(simpleNodes, simpleEdges)).toThrow(failure);
    expect(layoutSpy).toHaveBeenCalledTimes(1);
  });

  test('the helper never mutates host arrays, records, or dimensions during a failed initial attempt', () => {
    const nodes = Object.freeze(minimalNodes.map(node => Object.freeze({ ...node })));
    const edges = Object.freeze(minimalEdges.map(edge => Object.freeze({ ...edge })));
    const before = JSON.stringify({ nodes, edges });
    const result = layoutNodePositions(nodes, edges);
    expectFinitePositions(result, nodes);
    expect(JSON.stringify({ nodes, edges })).toBe(before);
    result.get('n0')!.width = 999;
    expect(nodes[0].width).toBe(310);
  });

  test('empty geometry returns an empty map without calling Dagre', () => {
    layoutSpy = spyOn(dagre, 'layout');
    expect(layoutNodePositions([], [])).toEqual(new Map());
    expect(layoutSpy).not.toHaveBeenCalled();
  });

  test('invalid dimensions, duplicate identities, or absent endpoints reject before layout', () => {
    layoutSpy = spyOn(dagre, 'layout');
    for (const invalid of [NaN, Infinity, -Infinity, 0, -1]) {
      expect(() => layoutNodePositions([{ ...simpleNodes[0], width: invalid }], [])).toThrow('finite positive');
      expect(() => layoutNodePositions([{ ...simpleNodes[0], height: invalid }], [])).toThrow('finite positive');
    }
    expect(() => layoutNodePositions([simpleNodes[0], simpleNodes[0]], [])).toThrow('unique nonempty');
    expect(() => layoutNodePositions([{ ...simpleNodes[0], id: '' }], [])).toThrow('unique nonempty');
    expect(() => layoutNodePositions(simpleNodes, [simpleEdges[0], simpleEdges[0]])).toThrow('unique nonempty');
    expect(() => layoutNodePositions(simpleNodes, [{ ...simpleEdges[0], id: '' }])).toThrow('unique nonempty');
    expect(() => layoutNodePositions(simpleNodes, [{ ...simpleEdges[0], source: 'absent' }])).toThrow('supplied nodes');
    expect(() => layoutNodePositions([], simpleEdges)).toThrow('supplied nodes');
    expect(layoutSpy).not.toHaveBeenCalled();
  });
});
