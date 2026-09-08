export interface CameraNode {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface CameraSize { width: number; height: number }
export interface CameraViewport { x: number; y: number; zoom: number }
export interface CameraFrame {
  viewport: CameraViewport;
  framedNodeIds: string[];
  focused: boolean;
}

const PADDING = 24;
const READABLE_ZOOM = .85;
const MAX_ZOOM = 1;
const MAX_NEIGHBORS = 6;
const positive = (value: number) => Number.isFinite(value) && value > 0;
const validSize = (size: CameraSize) => positive(size.width) && positive(size.height);
const compareIds = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const centerOf = (node: CameraNode) => ({ x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 });

interface Bounds { x: number; y: number; halfWidth: number; halfHeight: number }

function boundsOf(nodes: readonly CameraNode[], center?: { x: number; y: number }): Bounds | undefined {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.position.x);
    top = Math.min(top, node.position.y);
    right = Math.max(right, node.position.x + node.width);
    bottom = Math.max(bottom, node.position.y + node.height);
  }
  const x = center?.x ?? left + (right - left) / 2;
  const y = center?.y ?? top + (bottom - top) / 2;
  // A fixed center makes bounds symmetric, so a distant neighbor cannot move
  // the focused card away from the middle of the viewport.
  const halfWidth = Math.max(x - left, right - x);
  const halfHeight = Math.max(y - top, bottom - y);
  if (![x, y].every(Number.isFinite) || !positive(halfWidth) || !positive(halfHeight)) return undefined;
  return { x, y, halfWidth, halfHeight };
}

function fitZoom(bounds: Bounds, size: CameraSize): number {
  // Keep 24px padding on ordinary canvases; shrink it on tiny surfaces where
  // two 24px margins would leave insufficient or negative drawing space.
  const width = size.width - 2 * Math.min(PADDING, size.width / 4);
  const height = size.height - 2 * Math.min(PADDING, size.height / 4);
  return Math.min(MAX_ZOOM, width / 2 / bounds.halfWidth, height / 2 / bounds.halfHeight);
}

function result(bounds: Bounds, zoom: number, size: CameraSize, framedNodeIds: string[], focused: boolean): CameraFrame | undefined {
  const viewport = { x: size.width / 2 - bounds.x * zoom, y: size.height / 2 - bounds.y * zoom, zoom };
  if (!positive(zoom) || ![viewport.x, viewport.y].every(Number.isFinite)) return undefined;
  return { viewport, framedNodeIds, focused };
}

/** Frame only supplied, already-visible layout geometry; this does not filter or lay out a graph. */
export function frameCamera(
  nodes: readonly CameraNode[],
  edges: readonly { source: string; target: string }[],
  size: CameraSize,
  focusId?: string,
): CameraFrame | undefined {
  if (!nodes.length || !validSize(size)) return undefined;
  const byId = new Map<string, CameraNode>();
  for (const node of nodes) {
    if (byId.has(node.id) || !positive(node.width) || !positive(node.height)
      || ![node.position.x, node.position.y, node.position.x + node.width, node.position.y + node.height].every(Number.isFinite)) return undefined;
    byId.set(node.id, node);
  }
  const focus = focusId === undefined ? undefined : byId.get(focusId);
  const allIds = [...byId.keys()].sort(compareIds);
  if (!focus) {
    const bounds = boundsOf(nodes);
    return bounds ? result(bounds, fitZoom(bounds, size), size, allIds, false) : undefined;
  }

  const center = centerOf(focus);
  const focusBounds = boundsOf([focus], center);
  if (!focusBounds) return undefined;
  // Only the focus card itself can lower the readability floor. Its incident
  // edges and neighbors never force the user to read a smaller card.
  const readableFloor = Math.min(READABLE_ZOOM, fitZoom(focusBounds, size));
  const allBounds = boundsOf(nodes, center);
  if (allBounds && fitZoom(allBounds, size) >= READABLE_ZOOM) {
    return result(allBounds, fitZoom(allBounds, size), size, [focus.id, ...allIds.filter(id => id !== focus.id)], true);
  }

  const neighborIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source === focus.id && edge.target !== focus.id && byId.has(edge.target)) neighborIds.add(edge.target);
    if (edge.target === focus.id && edge.source !== focus.id && byId.has(edge.source)) neighborIds.add(edge.source);
  }
  const distance = (node: CameraNode) => {
    const nodeCenter = centerOf(node);
    return Math.hypot((nodeCenter.x - center.x) / size.width, (nodeCenter.y - center.y) / size.height);
  };
  const candidates = [...neighborIds].map(id => byId.get(id)!).sort((left, right) => {
    const leftDistance = distance(left), rightDistance = distance(right);
    return leftDistance < rightDistance ? -1 : leftDistance > rightDistance ? 1 : compareIds(left.id, right.id);
  });
  const framed = [focus];
  let bounds = focusBounds;
  for (const candidate of candidates) {
    if (framed.length > MAX_NEIGHBORS) break;
    const candidateBounds = boundsOf([...framed, candidate], center);
    if (candidateBounds && fitZoom(candidateBounds, size) >= readableFloor) {
      framed.push(candidate);
      bounds = candidateBounds;
    }
  }
  return result(bounds, fitZoom(bounds, size), size, framed.map(node => node.id), true);
}

/** Preserve the world point under the viewport center and preserve zoom. */
export function resizeCamera(viewport: CameraViewport, previousSize: CameraSize, nextSize: CameraSize): CameraViewport {
  if (!validSize(previousSize) || !validSize(nextSize) || !positive(viewport.zoom) || ![viewport.x, viewport.y].every(Number.isFinite)) {
    throw new RangeError('Camera viewport and canvas sizes must be finite with positive dimensions and zoom');
  }
  const resized = {
    x: viewport.x + (nextSize.width - previousSize.width) / 2,
    y: viewport.y + (nextSize.height - previousSize.height) / 2,
    zoom: viewport.zoom,
  };
  if (![resized.x, resized.y].every(Number.isFinite)) throw new RangeError('Resized camera coordinates must be finite');
  return resized;
}
