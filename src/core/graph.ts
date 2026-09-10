import type { GraphDocument, GraphEdge, GraphLocation, GraphNode, ReceiptAssessment, ReceiptRef } from './types.js';
import { isReceiptAssessment, stableJson, subjectKey } from './validate.js';

export function buildGraphIndex(doc: GraphDocument) {
  const nodes = new Map(doc.nodes.map(n => [n.id, n]));
  const edges = new Map(doc.edges.map(e => [e.id, e]));
  const incoming = new Map<string, GraphEdge[]>(), outgoing = new Map<string, GraphEdge[]>();
  const children = new Map<string, GraphNode[]>();
  for (const n of doc.nodes) { incoming.set(n.id, []); outgoing.set(n.id, []); if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]); }
  for (const e of doc.edges) { incoming.get(e.target)?.push(e); outgoing.get(e.source)?.push(e); }
  return { nodes, edges, incoming, outgoing, children };
}

export function traverse(doc: GraphDocument, startId: string, direction: 'both' | 'upstream' | 'downstream' = 'both', options: { maxDepth?: number; categories?: GraphEdge['category'][] } = {}): Set<string> {
  const index = buildGraphIndex(doc), visited = new Set<string>();
  if (!index.nodes.has(startId)) return visited;
  // Union of directed ancestors and descendants, not undirected component traversal.
  // Otherwise a shared input would incorrectly pull unrelated sibling consumers into lineage.
  const walk = (side: 'upstream' | 'downstream') => {
    const seen = new Set([startId]);
    const queue: [string, number][] = [[startId, 0]];
    for (let i = 0; i < queue.length; i++) {
      const [id, depth] = queue[i]; visited.add(id);
      if (depth >= (options.maxDepth ?? Infinity)) continue;
      for (const edge of (side === 'upstream' ? index.incoming : index.outgoing).get(id) ?? []) {
        if (options.categories && !options.categories.includes(edge.category)) continue;
        const next = side === 'upstream' ? edge.source : edge.target;
        if (!seen.has(next)) { seen.add(next); queue.push([next, depth + 1]); }
      }
    }
  };
  if (direction !== 'downstream') walk('upstream');
  if (direction !== 'upstream') walk('downstream');
  return visited;
}

export interface RecordDiff { added: string[]; removed: string[]; changed: string[]; unchanged: string[] }
export function diffGraphs(before: GraphDocument, after: GraphDocument): { nodes: RecordDiff; edges: RecordDiff } {
  const diff = (a: {id:string}[], b: {id:string}[]): RecordDiff => {
    const old = new Map(a.map(x => [x.id, x])), next = new Map(b.map(x => [x.id, x]));
    const result: RecordDiff = {added: [], removed: [], changed: [], unchanged: []};
    for (const n of b) { if (!old.has(n.id)) result.added.push(n.id); else if (stableJson(old.get(n.id)) !== stableJson(n)) result.changed.push(n.id); else result.unchanged.push(n.id); }
    for (const n of a) if (!next.has(n.id)) result.removed.push(n.id);
    return result;
  };
  return { nodes: diff(before.nodes, after.nodes), edges: diff(before.edges, after.edges) };
}

/** Restrict clickable links; relative files remain useful in offline reports. */
export function safeUrl(value: string): string | null {
  if (!value || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith('//')) return null;
  if (/^https?:\/\//i.test(value)) { try { const u = new URL(value); return !u.username && !u.password ? value : null; } catch { return null; } }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  // Percent-encoded schemes and control characters must not acquire a new interpretation.
  try { const decoded = decodeURIComponent(value); if (decoded !== value && (/^[a-z][a-z\d+.-]*:/i.test(decoded) || /[\u0000-\u0020\u007f\\]/.test(decoded) || decoded.startsWith('//'))) return null; } catch { return null; }
  return value;
}

export function encodeLocation(location: GraphLocation): string {
  const p = new URLSearchParams();
  for (const key of ['selectedId', 'selectedType', 'focusId', 'direction', 'query', 'traceId', 'traceVariableId'] as const) if (location[key]) p.set(key, location[key]!);
  if (location.kinds?.length) p.set('kinds', JSON.stringify(location.kinds));
  if (location.collapsedIds?.length) p.set('collapsedIds', JSON.stringify(location.collapsedIds));
  if (location.depth !== undefined) p.set('depth', String(location.depth));
  if (location.showContainment !== undefined) p.set('showContainment', String(location.showContainment));
  for (const key of ['traceControls', 'traceContext'] as const) if (location[key] !== undefined) p.set(key, String(location[key]));
  return `#${p.toString()}`;
}
export function decodeLocation(hash: string): GraphLocation {
  const p = new URLSearchParams(hash.replace(/^#/, '')), result: GraphLocation = {};
  for (const key of ['selectedId', 'focusId', 'query', 'traceId', 'traceVariableId'] as const) if (p.get(key)) result[key] = p.get(key)!;
  if (p.get('selectedType') === 'node' || p.get('selectedType') === 'edge') result.selectedType = p.get('selectedType') as 'node'|'edge';
  if (['upstream','downstream','both'].includes(p.get('direction') ?? '')) result.direction = p.get('direction') as GraphLocation['direction'];
  const depth = Number(p.get('depth'));
  if (p.has('depth') && Number.isSafeInteger(depth) && depth >= 1 && depth <= 1000) result.depth = depth;
  if (p.get('showContainment') === 'true' || p.get('showContainment') === 'false') result.showContainment = p.get('showContainment') === 'true';
  for (const key of ['traceControls', 'traceContext'] as const) if (p.get(key) === 'true' || p.get(key) === 'false') result[key] = p.get(key) === 'true';
  for (const key of ['kinds', 'collapsedIds'] as const) { try { const a = JSON.parse(p.get(key) ?? 'null'); if (Array.isArray(a) && a.every(x=>typeof x==='string')) result[key]=a; } catch { /* Invalid optional state does not prevent opening a graph. */ } }
  return result;
}

/** A snapshot cannot declare itself verified. Only explicitly supplied host assessments qualify. */
export function getReceiptAssessment(doc: GraphDocument, receipt: ReceiptRef, assessments: ReceiptAssessment[], documentSha256?: string): ReceiptAssessment | undefined {
  if (!documentSha256 || !/^[a-f0-9]{64}$/i.test(documentSha256)) return undefined;
  if (!Array.isArray(assessments) || assessments.some(a => !isReceiptAssessment(a))) return undefined;
  const matches = assessments.filter(a => a.receiptId === receipt.id && a.documentSha256 === documentSha256);
  // Contradictory reports do not silently become a green badge.
  if (matches.length !== 1) return undefined;
  const a = matches[0];
  if (!['verified','failed','unchecked','unavailable'].includes(a.status)) return undefined;
  if (a.status !== 'verified') return a;
  if (!receipt.sha256 || a.receiptSha256 !== receipt.sha256) return undefined;
  const index = buildGraphIndex(doc), activities = new Map(doc.activities?.map(x => [x.id, x]));
  if (receipt.subjects.some(s => !s.revision || (s.type === 'node' ? index.nodes.get(s.id) : s.type === 'edge' ? index.edges.get(s.id) : activities.get(s.id))?.revision !== s.revision)) return undefined;
  const expected = [...new Set(receipt.subjects.map(subjectKey))].sort();
  const actual = [...new Set((a.subjects ?? []).map(subjectKey))].sort();
  if (!expected.length || stableJson(expected) !== stableJson(actual)) return undefined;
  const artifacts = new Map(doc.artifacts?.map(x => [x.id, x]));
  const bound = new Map(a.artifacts?.map(x => [x.id, x.sha256]));
  if (stableJson([...(receipt.artifactIds ?? [])].sort()) !== stableJson([...(a.artifacts ?? []).map(x => x.id)].sort())) return undefined;
  if (!receipt.artifactIds?.length || receipt.artifactIds.some(id => !artifacts.get(id)?.sha256 || bound.get(id) !== artifacts.get(id)?.sha256)) return undefined;
  return a;
}
