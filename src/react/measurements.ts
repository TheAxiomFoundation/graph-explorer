import type { NodeChange } from '@xyflow/react';

export type NodeMeasurements = ReadonlyMap<string, { width: number; height: number }>;

/** Keep browser measurements in presentation state, never in graph records. */
export function updateNodeMeasurements(previous: NodeMeasurements, changes: readonly NodeChange[], visibleIds: ReadonlySet<string>): NodeMeasurements {
  let next: Map<string, { width: number; height: number }> | undefined;
  for (const id of previous.keys()) {
    if (!visibleIds.has(id)) { next ??= new Map(previous); next.delete(id); }
  }
  for (const change of changes) {
    if (change.type !== 'dimensions' || !visibleIds.has(change.id) || !change.dimensions) continue;
    const { width, height } = change.dimensions;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    const existing = (next ?? previous).get(change.id);
    if (existing?.width === width && existing.height === height) continue;
    next ??= new Map(previous);
    next.set(change.id, { width, height });
  }
  return next ?? previous;
}
