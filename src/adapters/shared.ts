import type { JsonValue, SourceRef } from '../core/types.js';

export function jsonObject(value: unknown, label: string): Record<string, JsonValue> {
  const seen = new Set<object>();
  function copy(item: unknown): JsonValue {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item))) return item;
    if (typeof item !== 'object' || !item || seen.has(item)) throw new Error(`${label} must contain only acyclic, finite JSON data`);
    seen.add(item);
    let result: JsonValue;
    if (Array.isArray(item)) result = item.map(copy);
    else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new Error(`${label} must contain plain JSON objects`);
      result = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined).map(([key, value]) => [key, copy(value)]));
    }
    seen.delete(item);
    return result;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return copy(value) as Record<string, JsonValue>;
}

export function textField(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}

export function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item) => textField(item, label));
}

/** JSON tuples prevent delimiter collisions and do not depend on array ordering. */
export function edgeId(source: string, target: string, kind: string): string {
  return JSON.stringify([source, target, kind]);
}

export function sourceRef(label: string | null | undefined, url: string | null | undefined): SourceRef[] {
  if (!label && !url) return [];
  const safe = typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined;
  return [{ label: label || url!, ...(safe ? { url: safe } : {}) }];
}
