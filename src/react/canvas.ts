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
  return document.nodes.filter(node => (!location.kinds?.length || location.kinds.includes(node.kind))
    && words.every(word => `${node.label} ${node.id} ${node.kind} ${node.description ?? ''} ${JSON.stringify(node.data ?? {})}`.toLocaleLowerCase().includes(word)));
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
  let visible = (options.searchFiltersCanvas === false ? document.nodes : matching).filter(allowed);
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
