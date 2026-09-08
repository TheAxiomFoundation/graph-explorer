import type { ActivityRecord, ArtifactRef, GraphDocument, GraphEdge, GraphNode, JsonValue, SourceRef } from '../core/types.js';
import registry from './thesis-registry.json';
import { edgeId, jsonObject, sourceRef, stringList, textField } from './shared.js';

/** Exact read-only API envelope from thesis_core.api.record_view. */
export interface ThesisRecord {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  committed_at?: string | null;
}

export interface ThesisAdapterOptions {
  id?: string;
  title?: string;
  revision?: string;
  sources?: SourceRef[];
  /** Additional context about how records were exported, not a verification verdict. */
  provenance?: Record<string, JsonValue>;
}

export const THESIS_REGISTRY_SOURCE = registry.source;
const links = registry.links as Record<string, Array<{ field: string; target_kind: string; relation: string; many: boolean; required: boolean }>>;
const artifactFields = registry.artifactFields as Record<string, string[]>;
const sha256 = (value: unknown, label: string): string => {
  const text = textField(value, label);
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} must be a lowercase SHA-256 identity`);
  return text;
};

/**
 * Project immutable scientific records using Thesis's recorded LINK_SPECS.
 * Record IDs are retained, not recomputed or promoted to verified identities.
 * The adapter never infers that a supplied evidence bundle was consumed by an agent.
 */
export function fromThesisRecords(records: readonly ThesisRecord[], options: ThesisAdapterOptions = {}): GraphDocument {
  if (!Array.isArray(records)) throw new Error('Thesis records must be an array');
  const nodes = new Map<string, GraphNode>();
  const envelopes = new Map<string, Record<string, JsonValue>>();
  const edges: GraphEdge[] = [];
  const activities: ActivityRecord[] = [];
  const artifacts = new Map<string, ArtifactRef>();
  const missing = new Set<string>();

  for (const raw of records) {
    const envelope = jsonObject(raw, 'Thesis envelope');
    const id = sha256(envelope.id, 'record id');
    const kind = textField(envelope.kind, 'record kind');
    if (!Object.hasOwn(links, kind)) throw new Error(`Unknown Thesis record kind: ${kind}; update the pinned registry`);
    const payload = jsonObject(envelope.payload, 'record payload');
    if (payload.kind !== kind) throw new Error(`Thesis envelope/payload kind mismatch for ${id}`);
    if (nodes.has(id)) throw new Error(`Duplicate Thesis record id: ${id}`);
    envelopes.set(id, envelope);
    const title = [payload.name, payload.target_id, payload.measurement_period, payload.observed_model].find((value) => typeof value === 'string');
    const sources = [...sourceRef(typeof payload.name === 'string' ? payload.name : kind, typeof payload.url === 'string' ? payload.url : null), ...(options.sources ?? [])];
    if (payload.binding && typeof payload.binding === 'object' && !Array.isArray(payload.binding)) {
      const url = payload.binding.source_url;
      if (typeof url === 'string') sources.push(...sourceRef('Registered source', url));
    }
    const node: GraphNode = { id, revision: id, kind, label: title ? `${kind.replaceAll('_', ' ')} · ${title}` : `${kind.replaceAll('_', ' ')} · ${id.slice(0, 10)}`, data: { record: payload, envelope: Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'payload')), evidenceAvailability: 'record_supplied_identity_unverified' }, sources, statuses: [{ label: 'Record supplied; identity not verified', tone: 'neutral' }] };
    if (typeof payload.mode === 'string') node.statuses!.push({ label: `Mode: ${payload.mode}`, tone: payload.mode === 'replay' ? 'warning' : 'neutral' });
    if (typeof payload.outcome === 'string') node.statuses!.push({ label: `Recorded outcome: ${payload.outcome}`, tone: payload.outcome === 'failed' ? 'negative' : 'neutral' });
    if (payload.unavailable_reason) node.statuses!.push({ label: `Unavailable: ${payload.unavailable_reason}`, tone: 'warning' });
    if (kind === 'publication_proof') node.statuses!.push({ label: 'Publication proof declared; not verified', tone: 'neutral' });
    nodes.set(id, node);
  }

  for (const [id, envelope] of envelopes) {
    const kind = envelope.kind as string;
    const payload = envelope.payload as Record<string, JsonValue>;
    for (const spec of links[kind]) {
      const value = payload[spec.field];
      if (value == null) {
        if (spec.required) throw new Error(`Thesis ${kind} is missing ${spec.field}`);
        continue;
      }
      const targets = spec.many ? stringList(value, spec.field) : [textField(value, spec.field)];
      if (new Set(targets).size !== targets.length) throw new Error(`Thesis ${spec.field} repeats an identity`);
      targets.forEach((target, index) => {
        sha256(target, spec.field);
        const existing = nodes.get(target);
        if (existing && existing.kind !== spec.target_kind) throw new Error(`Thesis ${spec.field} expects ${spec.target_kind}, received ${existing.kind}`);
        if (!existing) {
          missing.add(target);
          nodes.set(target, { id: target, revision: target, label: `${spec.target_kind.replaceAll('_', ' ')} · ${target.slice(0, 10)}`, kind: spec.target_kind, data: { evidenceAvailability: 'record_not_supplied' }, statuses: [{ label: 'Referenced record not supplied', tone: 'warning' }] });
        }
        const evidenceRole = spec.field === 'evidence_bundle_id' ? 'provided' : spec.field === 'observation_ids' && kind === 'evidence_bundle' ? 'included' : 'declared_reference';
        const category = ['observation', 'source_exchange', 'evidence_bundle'].includes(spec.target_kind) ? 'evidence' : ['publication_proof', 'publication_manifest'].includes(spec.target_kind) ? 'provenance' : 'dependency';
        edges.push({ id: edgeId(target, id, spec.relation), source: target, target: id, kind: spec.relation, category, label: evidenceRole === 'provided' ? 'Evidence bundle supplied to task' : spec.relation.replaceAll('_', ' '), data: { fieldPath: spec.many ? `${spec.field}[${index}]` : spec.field, evidenceRole, recordRelationship: 'declared_by_LINK_SPECS' } });
      });
    }

    const referencedArtifacts = new Set<string>();
    function addArtifact(hash: unknown, label: string, mediaType?: string) {
      const digest = sha256(hash, label);
      referencedArtifacts.add(digest);
      if (!artifacts.has(digest)) artifacts.set(digest, { id: digest, sha256: digest, label: `${label} · ${digest.slice(0, 10)}`, ...(mediaType ? { mediaType } : {}) });
    }
    function walk(value: JsonValue, path: string) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
      if (typeof value.sha256 === 'string' && typeof value.bytes === 'number' && typeof value.media_type === 'string') addArtifact(value.sha256, path, value.media_type);
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
    walk(payload, kind);
    for (const field of artifactFields[kind]) {
      const value = payload[field];
      if (value == null) continue;
      for (const hash of Array.isArray(value) ? value : [value]) addArtifact(hash, field);
    }
    if (kind === 'forecaster_version' && payload.inference_settings && typeof payload.inference_settings === 'object' && !Array.isArray(payload.inference_settings)) {
      for (const field of ['wrapper_sha256', 'wrapper_module_sha256']) {
        const hash = payload.inference_settings[field];
        if (hash != null) addArtifact(hash, field);
      }
    }
    nodes.get(id)!.data!.artifactIds = [...referencedArtifacts];
    if (referencedArtifacts.size) nodes.get(id)!.statuses!.push({ label: `${referencedArtifacts.size} artifact references; bytes not supplied`, tone: 'neutral' });
    if (kind === 'forecast_run') {
      activities.push({ id: `execution:${id}`, label: 'Recorded forecast execution', kind: 'execution', revision: id, ...(typeof payload.observed_model === 'string' ? { agent: { name: payload.observed_model, model: payload.observed_model } } : {}), ...(typeof payload.completed_at === 'string' ? { endedAt: payload.completed_at } : {}), inputs: [{ subject: { type: 'node', id: payload.attempt_id as string, revision: payload.attempt_id as string }, role: 'provided' }], outputs: [{ type: 'node', id, revision: id }], artifactIds: [...referencedArtifacts], data: { authority: 'forecast_run_record', consumptionEvidence: 'not_inferred_from_task_evidence' } });
    }
  }
  return { schemaVersion: 'graph-explorer/v1', id: options.id ?? 'thesis-scientific-records', title: options.title ?? 'Thesis scientific records', ...(options.revision ? { revision: options.revision } : {}), description: 'Declared scientific record relationships. Supplied evidence and publication proofs are not verified by this adapter.', nodes: [...nodes.values()], edges, activities, artifacts: [...artifacts.values()], metadata: { adapter: 'thesis/scientific-records', registrySource: registry.source, missingRecordIds: [...missing], artifactAvailability: 'references_only', ...(options.provenance ? { provenance: options.provenance } : {}) } };
}
