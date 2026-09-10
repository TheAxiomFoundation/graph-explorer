import type { GraphDocument, GraphEdge, GraphLineageBoundary, GraphLocation } from './types.js';
import { buildGraphIndex } from './graph.js';

export interface LineageTraceOptions {
  /** Follow authored control inputs recursively alongside value inputs. */
  includeControls?: boolean;
  /** Add one-hop incident context edges without traversing through them. */
  includeContext?: boolean;
}

export interface LineageTrace {
  nodeIds: string[];
  edgeIds: string[];
  boundaries: (GraphLineageBoundary & { declared: boolean })[];
  /** Strongly connected components, including self loops, in the traced inputs. */
  cycles: string[][];
  excludedControlEdgeIds: string[];
  contextEdgeIds: string[];
  validRoot: boolean;
}

/** Iterative SCC detection avoids call-stack limits on long native pipelines. */
function cycleComponents(nodeIds: string[], edges: GraphEdge[]): string[][] {
  const outgoing = new Map(nodeIds.map(id => [id, [] as string[]]));
  const incoming = new Map(nodeIds.map(id => [id, [] as string[]]));
  for (const edge of edges) {
    outgoing.get(edge.source)!.push(edge.target);
    incoming.get(edge.target)!.push(edge.source);
  }
  const visited = new Set<string>(), finished: string[] = [];
  for (const id of nodeIds) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const neighbors = outgoing.get(frame.id)!;
      if (frame.next === neighbors.length) { finished.push(frame.id); stack.pop(); continue; }
      const next = neighbors[frame.next++]!;
      if (!visited.has(next)) { visited.add(next); stack.push({ id: next, next: 0 }); }
    }
  }
  const assigned = new Set<string>(), cycles: string[][] = [];
  const order = new Map(nodeIds.map((id, index) => [id, index]));
  for (let index = finished.length - 1; index >= 0; index--) {
    const id = finished[index]!;
    if (assigned.has(id)) continue;
    assigned.add(id);
    const component: string[] = [], queue = [id];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]!; component.push(current);
      for (const next of incoming.get(current)!) {
        if (!assigned.has(next)) { assigned.add(next); queue.push(next); }
      }
    }
    if (component.length > 1 || outgoing.get(id)!.includes(id)) {
      component.sort((a, b) => order.get(a)! - order.get(b)!); cycles.push(component);
    }
  }
  return cycles.sort((a, b) => order.get(a[0]!)! - order.get(b[0]!)!);
}

/**
 * Trace explicit annotations in a validated snapshot, never guessed edge kinds.
 * A boundary stops upstream traversal. A source declaration, missing leaf or
 * cycle is reported as such; no result asserts completeness or verification.
 * Context-only nodes do not supply source boundaries or cycle evidence.
 */
export function traceLineage(document: GraphDocument, rootId: string, options: LineageTraceOptions = {}): LineageTrace {
  const result: LineageTrace = { nodeIds: [], edgeIds: [], boundaries: [], cycles: [], excludedControlEdgeIds: [], contextEdgeIds: [], validRoot: false };
  if (!document.lineage) return result;
  const index = buildGraphIndex(document);
  if (!index.nodes.has(rootId)) return result;
  result.validRoot = true;
  const roles = new Map(document.lineage.relations.map(relation => [relation.edgeId, relation.role]));
  const declarations = new Map(document.lineage.boundaries.map(boundary => [boundary.nodeId, boundary]));
  const reached = new Set([rootId]), edgeIds = new Set<string>(), excluded = new Set<string>();
  const foundBoundaries = new Map<string, LineageTrace['boundaries'][number]>();
  const queue = [rootId];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const nodeId = queue[cursor]!;
    const boundary = declarations.get(nodeId);
    if (boundary) { foundBoundaries.set(nodeId, { ...boundary, declared: true }); continue; }
    let inputs = 0;
    for (const edge of index.incoming.get(nodeId)!) {
      const role = roles.get(edge.id);
      if (role === 'control' && !options.includeControls) excluded.add(edge.id);
      if (role !== 'value' && !(role === 'control' && options.includeControls)) continue;
      inputs++; edgeIds.add(edge.id);
      if (!reached.has(edge.source)) { reached.add(edge.source); queue.push(edge.source); }
    }
    if (!inputs) foundBoundaries.set(nodeId, {
      nodeId, kind: 'unknown', declared: false,
      description: 'No declared upstream inputs in this trace and no source or unknown boundary was supplied.',
    });
  }
  const tracedNodeIds = document.nodes.filter(node => reached.has(node.id)).map(node => node.id);
  result.cycles = cycleComponents(tracedNodeIds, document.edges.filter(edge => edgeIds.has(edge.id)));
  result.boundaries = tracedNodeIds.flatMap(id => foundBoundaries.has(id) ? [foundBoundaries.get(id)!] : []);
  const contextIds = new Set<string>();
  const displayed = new Set(reached);
  if (options.includeContext) {
    for (const edge of document.edges) {
      if (roles.get(edge.id) !== 'context' || (!reached.has(edge.source) && !reached.has(edge.target))) continue;
      contextIds.add(edge.id); edgeIds.add(edge.id); displayed.add(edge.source); displayed.add(edge.target);
    }
  }
  result.nodeIds = document.nodes.filter(node => displayed.has(node.id)).map(node => node.id);
  result.edgeIds = document.edges.filter(edge => edgeIds.has(edge.id)).map(edge => edge.id);
  result.excludedControlEdgeIds = document.edges.filter(edge => excluded.has(edge.id)).map(edge => edge.id);
  result.contextEdgeIds = document.edges.filter(edge => contextIds.has(edge.id)).map(edge => edge.id);
  return result;
}

/** Authored display order chooses the first variable's last stage, not newest data. */
export function getDefaultLineageLocation(document: GraphDocument): GraphLocation | undefined {
  const variable = document.lineage?.variables[0];
  const stage = variable?.stages.at(-1);
  if (!variable || !stage || !document.nodes.some(node => node.id === stage.nodeId)) return undefined;
  return { traceId: stage.nodeId, traceVariableId: variable.id, selectedId: stage.nodeId, selectedType: 'node' };
}
