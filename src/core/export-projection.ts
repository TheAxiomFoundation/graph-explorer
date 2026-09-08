import type { GraphDocument } from './types.js';
import { parseGraphDocument, stableJson } from './validate.js';

/**
 * Pack a document explicitly projected by the host. This does not infer a
 * subset, redact fields, repair references, or select a fallback snapshot.
 * Returned JSON is the exact representation the downstream exporter hashes.
 */
export function prepareGraphExport(projected: unknown): { document: GraphDocument; json: string } {
  const validated = parseGraphDocument(projected);
  const json = `${stableJson(validated)}\n`;
  return { document: parseGraphDocument(JSON.parse(json)), json };
}
