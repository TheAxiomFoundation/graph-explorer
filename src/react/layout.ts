import dagre from '@dagrejs/dagre';

export interface LayoutNode { id: string; width: number; height: number }
export interface LayoutEdge { id: string; source: string; target: string }
/** Coordinates identify the node center, matching Dagre's ordinary output. */
export interface LayoutPosition { x: number; y: number; width: number; height: number }

const settings = { rankdir: 'LR', ranksep: 116, nodesep: 40, edgesep: 24, marginx: 32, marginy: 32 };
const intersectionFailure = 'Not possible to find intersection inside of the rectangle';
const positive = (value: number) => Number.isFinite(value) && value > 0;
const identifier = (value: string) => typeof value === 'string' && value.trim().length > 0;

class InvalidLayoutGeometry extends Error {}

function validateInput(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): void {
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!identifier(node.id) || nodeIds.has(node.id)) throw new TypeError('Layout nodes must have unique nonempty string IDs');
    if (!positive(node.width) || !positive(node.height)) throw new RangeError('Layout node dimensions must be finite positive numbers');
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!identifier(edge.id) || edgeIds.has(edge.id)) throw new TypeError('Layout edges must have unique nonempty string IDs');
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw new TypeError('Layout edge endpoints must reference supplied nodes');
    edgeIds.add(edge.id);
  }
}

function attempt(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], disableOptimalOrderHeuristic: boolean): Map<string, LayoutPosition> {
  // A retry gets a completely new graph: Dagre may have partially modified its
  // working graph before throwing. Host records and dimensions are never passed
  // to the layout engine by reference.
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ ...settings });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const { id, width, height } of nodes) graph.setNode(id, { width, height });
  for (const { id, source, target } of edges) graph.setEdge(source, target, {}, id);
  if (graph.nodeCount() !== nodes.length || graph.edgeCount() !== edges.length) {
    throw new InvalidLayoutGeometry('Dagre did not retain every supplied node and edge');
  }
  if (disableOptimalOrderHeuristic) dagre.layout(graph, { disableOptimalOrderHeuristic: true });
  else dagre.layout(graph);

  const positions = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    const point = graph.node(node.id);
    if (!point || ![point.x, point.y, point.width, point.height,
      point.x - point.width / 2, point.x + point.width / 2,
      point.y - point.height / 2, point.y + point.height / 2].every(Number.isFinite)
      || point.width !== node.width || point.height !== node.height) {
      throw new InvalidLayoutGeometry('Dagre produced invalid node geometry');
    }
    positions.set(node.id, { x: point.x, y: point.y, width: point.width, height: point.height });
  }
  for (const edge of edges) {
    const routed = graph.edge({ v: edge.source, w: edge.target, name: edge.id });
    if (!routed || !Array.isArray(routed.points) || routed.points.length < 2
      || !routed.points.every((point: { x: number; y: number }) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) {
      throw new InvalidLayoutGeometry('Dagre produced invalid edge geometry');
    }
  }
  if (graph.nodeCount() !== nodes.length || graph.edgeCount() !== edges.length
    || !positive(graph.graph().width) || !positive(graph.graph().height)) {
    throw new InvalidLayoutGeometry('Dagre produced invalid graph geometry');
  }
  return positions;
}

/**
 * Preserve successful default Dagre layouts; retry its degenerate ordering case
 * without changing nodes, relationships, sizes, or layout settings.
 */
export function layoutNodePositions(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Map<string, LayoutPosition> {
  validateInput(nodes, edges);
  if (!nodes.length) return new Map();
  try {
    return attempt(nodes, edges, false);
  } catch (error) {
    if (!(error instanceof InvalidLayoutGeometry) && !(error instanceof Error && error.message === intersectionFailure)) throw error;
    // In pinned Dagre 3.1.1, lib/order/index.ts assigns the initial valid order
    // before this public option skips crossing-minimization sweeps. Those sweeps
    // can leave dummy-node coordinates invalid for a cyclic multigraph. Keeping
    // the ordinary first attempt avoids rearranging graphs that already work.
    try {
      return attempt(nodes, edges, true);
    } catch (retryError) {
      throw new Error('Dagre layout failed after retrying without the optimal ordering heuristic', {
        cause: new AggregateError([error, retryError], 'Both layout attempts failed'),
      });
    }
  }
}
