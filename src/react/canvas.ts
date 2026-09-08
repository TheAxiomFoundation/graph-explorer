import type { GraphDocument, GraphEdge, GraphLocation, GraphNode } from '../core/types.js';
import { traverse } from '../core/graph.js';

export interface CanvasOptions {
  /** Presentation only. Excluded records remain available to search and inspection. */
  canvasNodeFilter?: (node: GraphNode, document: GraphDocument) => boolean;
  /** False keeps search/type filters confined to the record index. */
  searchFiltersCanvas?: boolean;
}

export function matchingRecords(document: GraphDocument, location: GraphLocation): GraphNode[] {
  const words = (location.query ?? '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const candidates = document.nodes.filter(node => !location.kinds?.length || location.kinds.includes(node.kind));
  if (!words.length) return candidates;
  const query = words.join(' ');
  const exact: GraphNode[] = [], identity: GraphNode[] = [], other: GraphNode[] = [];
  for (const node of candidates) {
    const label = node.label.toLocaleLowerCase();
    const id = node.id.toLocaleLowerCase();
    const direct = `${label} ${id}`;
    if (words.every(word => direct.includes(word))) {
      // Stable buckets retain document order within each relevance tier. Keep
      // matching token-based; only the exact tier normalizes repeated spaces.
      const isExact = [label, id].some(value => value.trim().replace(/\s+/g, ' ') === query);
      (isExact ? exact : identity).push(node);
    } else {
      const text = `${direct} ${node.kind} ${node.description ?? ''} ${JSON.stringify(node.data ?? {})}`.toLocaleLowerCase();
      if (words.every(word => text.includes(word))) other.push(node);
    }
  }
  return [...exact, ...identity, ...other];
}

export function canvasRecords(document: GraphDocument, location: GraphLocation, matching: readonly GraphNode[], children: ReadonlyMap<string, ReadonlySet<string>>, options: CanvasOptions): GraphNode[] {
  const hidden = new Set<string>();
  for (const id of location.collapsedIds ?? []) {
    const queue = [...(children.get(id) ?? [])];
    for (let i = 0; i < queue.length; i++) if (queue[i] !== id && !hidden.has(queue[i])) {
      hidden.add(queue[i]); queue.push(...children.get(queue[i]) ?? []);
    }
  }
  const allowed = (node: GraphNode) => !hidden.has(node.id) && (!options.canvasNodeFilter || options.canvasNodeFilter(node, document));
  // Index relevance must not reorder Dagre's native input or alter canvas scope.
  const matchingIds = options.searchFiltersCanvas === false ? undefined : new Set(matching.map(node => node.id));
  let visible = document.nodes.filter(node => (!matchingIds || matchingIds.has(node.id)) && allowed(node));
  const focus = document.nodes.find(node => node.id === location.focusId);
  if (focus) {
    // Traverse native edges in the full document. Hidden records may be lineage
    // intermediates, but filtering never invents a shortcut edge between them.
    const visited = traverse(document, focus.id, location.direction ?? 'both', { maxDepth: location.depth ?? 1,
      ...(location.showContainment === false ? { categories: ['dependency', 'evidence', 'provenance', 'reference', undefined] as GraphEdge['category'][] } : {}) });
    visible = visible.filter(node => visited.has(node.id));
    // Focus can override the search filter, never the host's canvas projection.
    if (allowed(focus) && !visible.some(node => node.id === focus.id)) visible.unshift(focus);
  }
  return visible;
}

export function nodeDimensions(size?: { width: number; height: number }): { width: number; height: number } {
  if (size === undefined) return { width: 248, height: 126 };
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) throw new Error('getNodeSize must return finite positive width and height');
  return { width: size.width, height: size.height };
}
