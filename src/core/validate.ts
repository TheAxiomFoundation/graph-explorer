import type { GraphDocument, ReceiptAssessment, SubjectRef } from './types.js';

export interface ValidationIssue { path: string; message: string }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[] }
type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/i.test(v);

export class GraphValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map(i => `${i.path}: ${i.message}`).join('\n'));
    this.name = 'GraphValidationError';
  }
}

/** Validates external snapshots before adapters, viewers, or exporters use them. */
export function validateGraphDocument(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (!object(value)) return { valid: false, issues: [{ path: '$', message: 'Expected a graph object' }] };
  const str = (obj: Obj, key: string, path: string, required = false) => {
    if ((required || obj[key] !== undefined) && !text(obj[key])) issue(`${path}.${key}`, 'Expected a nonempty string');
  };
  const json = (v: unknown, path: string, seen = new Set<object>(), depth = 0): void => {
    if (depth > 64) { issue(path, 'JSON exceeds maximum nesting depth (64)'); return; }
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (Number.isInteger(v) && !Number.isSafeInteger(v)) issue(path, 'Unsafe integer: adapters must encode exact large integers as { integer_literal: "..." } before JSON.parse');
      return;
    }
    if (Array.isArray(v) || object(v)) {
      if (seen.has(v)) { issue(path, 'JSON cannot contain cycles'); return; }
      seen.add(v);
      for (const [k, item] of Object.entries(v)) json(item, `${path}.${k}`, seen, depth + 1);
      seen.delete(v);
    } else issue(path, 'Expected a finite JSON value');
  };
  const arr = (obj: Obj, key: string, path: string, required = false): unknown[] => {
    if (obj[key] === undefined && !required) return [];
    if (!Array.isArray(obj[key])) { issue(`${path}.${key}`, 'Expected an array'); return []; }
    return obj[key] as unknown[];
  };
  const records = (key: string, required = false): Map<string, Obj> => {
    const map = new Map<string, Obj>();
    arr(value, key, '$', required).forEach((v, i) => {
      const path = `$.${key}[${i}]`;
      if (!object(v)) { issue(path, 'Expected an object'); return; }
      str(v, 'id', path, true);
      if (text(v.id)) {
        if (map.has(v.id)) issue(`${path}.id`, `Duplicate identity ${v.id}`);
        else map.set(v.id, v);
      }
      str(v, 'revision', path);
    });
    return map;
  };
  const sources = (obj: Obj, path: string) => {
    arr(obj, 'sources', path).forEach((s, i) => {
      const p = `${path}.sources[${i}]`;
      if (!object(s)) return issue(p, 'Expected an object');
      str(s, 'label', p, true); str(s, 'url', p);
      if (s.sha256 !== undefined && !hash(s.sha256)) issue(`${p}.sha256`, 'Expected a SHA-256 hex digest');
    });
    arr(obj, 'statuses', path).forEach((s, i) => {
      const p = `${path}.statuses[${i}]`;
      if (!object(s)) return issue(p, 'Expected an object');
      str(s, 'label', p, true);
      if (s.tone !== undefined && (typeof s.tone !== 'string' || !['neutral', 'positive', 'warning', 'negative'].includes(s.tone))) issue(`${p}.tone`, 'Unknown status tone');
    });
    if (obj.data !== undefined) {
      if (!object(obj.data)) issue(`${path}.data`, 'Expected a JSON object');
      else json(obj.data, `${path}.data`);
    }
  };
  if (value.schemaVersion !== 'graph-explorer/v1') issue('$.schemaVersion', 'Unsupported graph schema version');
  str(value, 'id', '$', true); str(value, 'title', '$', true);
  str(value, 'description', '$'); str(value, 'revision', '$');
  const nodes = records('nodes', true), edges = records('edges', true);
  const activities = records('activities'), artifacts = records('artifacts'), receipts = records('receipts');
  for (const [id, n] of nodes) {
    const p = `$.nodes[${JSON.stringify(id)}]`;
    str(n, 'label', p, true); str(n, 'kind', p, true); str(n, 'description', p); str(n, 'parentId', p);
    sources(n, p);
    if (n.parentId !== undefined && !nodes.has(String(n.parentId))) issue(`${p}.parentId`, 'Unknown parent node');
  }
  for (const [id, e] of edges) {
    const p = `$.edges[${JSON.stringify(id)}]`;
    for (const key of ['source', 'target', 'kind']) str(e, key, p, true);
    str(e, 'label', p); str(e, 'description', p); sources(e, p);
    if (!nodes.has(String(e.source))) issue(`${p}.source`, 'Unknown source node');
    if (!nodes.has(String(e.target))) issue(`${p}.target`, 'Unknown target node');
    if (e.category !== undefined && (typeof e.category !== 'string' || !['dependency', 'containment', 'evidence', 'provenance', 'reference'].includes(e.category))) issue(`${p}.category`, 'Unknown edge category');
  }
  // Validate the union of structural edges and parent pointers in linear time.
  // Semantic cycles remain legal; cyclic containment cannot be folded coherently.
  const containment = new Map<string, Set<string>>(), indegree = new Map([...nodes.keys()].map(id => [id, 0]));
  const contain = (parent: string, child: string) => {
    if (!nodes.has(parent) || !nodes.has(child)) return;
    const children = containment.get(parent) ?? new Set<string>();
    if (!children.has(child)) { children.add(child); indegree.set(child, indegree.get(child)! + 1); }
    containment.set(parent, children);
  };
  for (const [id, n] of nodes) if (text(n.parentId)) contain(n.parentId, id);
  for (const e of edges.values()) if (e.category === 'containment' && text(e.source) && text(e.target)) contain(e.source, e.target);
  const roots = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  for (let i = 0; i < roots.length; i++) for (const child of containment.get(roots[i]) ?? []) { const degree = indegree.get(child)! - 1; indegree.set(child, degree); if (degree === 0) roots.push(child); }
  if (roots.length !== nodes.size) issue('$.nodes', 'Containment must not contain cycles (including structural edges and parent pointers)');
  const subject = (s: unknown, path: string) => {
    if (!object(s)) return issue(path, 'Expected a subject reference');
    str(s, 'id', path, true);
    const collection = s.type === 'node' ? nodes : s.type === 'edge' ? edges : s.type === 'activity' ? activities : undefined;
    if (!collection) return issue(`${path}.type`, 'Unknown subject type');
    const entity = collection.get(String(s.id));
    if (!entity) issue(`${path}.id`, 'Unknown subject');
    str(s, 'revision', path);
    if (s.revision !== undefined && entity?.revision !== s.revision) issue(`${path}.revision`, 'Subject revision does not match snapshot');
  };
  const artifactIds = (obj: Obj, path: string) => arr(obj, 'artifactIds', path).forEach((id, i) => {
    if (!text(id) || !artifacts.has(id)) issue(`${path}.artifactIds[${i}]`, 'Unknown artifact');
  });
  for (const [id, a] of artifacts) {
    const p = `$.artifacts[${JSON.stringify(id)}]`;
    str(a, 'label', p, true); str(a, 'uri', p); str(a, 'mediaType', p);
    if (a.sha256 !== undefined && !hash(a.sha256)) issue(`${p}.sha256`, 'Expected a SHA-256 hex digest');
  }
  for (const [id, a] of activities) {
    const p = `$.activities[${JSON.stringify(id)}]`;
    str(a, 'label', p, true); str(a, 'kind', p, true); artifactIds(a, p);
    if (a.agent !== undefined) {
      if (!object(a.agent)) issue(`${p}.agent`, 'Expected an agent object');
      else { str(a.agent, 'name', `${p}.agent`, true); str(a.agent, 'model', `${p}.agent`); str(a.agent, 'version', `${p}.agent`); }
    }
    for (const k of ['startedAt', 'endedAt']) if (a[k] !== undefined && (typeof a[k] !== 'string' || !Number.isFinite(Date.parse(a[k] as string)))) issue(`${p}.${k}`, 'Expected an ISO timestamp');
    if (text(a.startedAt) && text(a.endedAt) && Date.parse(a.startedAt) > Date.parse(a.endedAt)) issue(p, 'Activity ends before it starts');
    arr(a, 'inputs', p).forEach((input, i) => {
      const ip = `${p}.inputs[${i}]`;
      if (!object(input)) return issue(ip, 'Expected an input object');
      if (typeof input.role !== 'string' || !['provided', 'cited', 'consumed'].includes(input.role)) issue(`${ip}.role`, 'Unknown input role');
      subject(input.subject, `${ip}.subject`);
    });
    arr(a, 'outputs', p).forEach((s, i) => subject(s, `${p}.outputs[${i}]`));
    if (a.data !== undefined) { if (!object(a.data)) issue(`${p}.data`, 'Expected a JSON object'); else json(a.data, `${p}.data`); }
  }
  for (const [id, r] of receipts) {
    const p = `$.receipts[${JSON.stringify(id)}]`;
    str(r, 'label', p, true); str(r, 'uri', p); str(r, 'verifier', p); artifactIds(r, p);
    const subjects = arr(r, 'subjects', p, true);
    if (subjects.length === 0) issue(`${p}.subjects`, 'A receipt must name at least one subject');
    subjects.forEach((s, i) => subject(s, `${p}.subjects[${i}]`));
    if (r.sha256 !== undefined && !hash(r.sha256)) issue(`${p}.sha256`, 'Expected a SHA-256 hex digest');
  }
  if (value.metadata !== undefined) {
    if (!object(value.metadata)) issue('$.metadata', 'Expected a JSON object');
    else json(value.metadata, '$.metadata');
  }
  return { valid: issues.length === 0, issues };
}

export function parseGraphDocument(value: unknown): GraphDocument {
  const result = validateGraphDocument(value);
  if (!result.valid) throw new GraphValidationError(result.issues);
  // Strip extra top-level keys such as producer-supplied assessments or commands.
  const obj = value as GraphDocument;
  const { schemaVersion, id, title, description, revision, nodes, edges, activities, artifacts, receipts, metadata } = obj;
  return { schemaVersion, id, title, description, revision, nodes, edges, activities, artifacts, receipts, metadata };
}

/** Pure deterministic comparison encoding; deliberately not a cryptographic canonicalization. */
export function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const subjectKey = (s: SubjectRef) => JSON.stringify([s.type, s.id, s.revision ?? null]);

/** Shape checking does not establish trust; the host must supply the verifier report separately. */
export function isReceiptAssessment(value: unknown): value is ReceiptAssessment {
  if (!object(value) || !text(value.receiptId) || !text(value.verifier) || !text(value.scope) || !hash(value.documentSha256)) return false;
  if (typeof value.status !== 'string' || !['verified','failed','unavailable','unchecked'].includes(value.status)) return false;
  for (const key of ['checkedAt','detail','reportUri']) if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  if (value.receiptSha256 !== undefined && !hash(value.receiptSha256)) return false;
  if (value.subjects !== undefined && (!Array.isArray(value.subjects) || !value.subjects.every(s => object(s) && ['node','edge','activity'].includes(s.type as string) && text(s.id) && (s.revision === undefined || text(s.revision))))) return false;
  if (value.artifacts !== undefined && (!Array.isArray(value.artifacts) || !value.artifacts.every(a => object(a) && text(a.id) && hash(a.sha256)))) return false;
  return true;
}
