import type { GraphDocument, GraphEdge, GraphNode, JsonValue, SourceRef } from '../core/types.js';
import { edgeId, jsonObject, sourceRef, stringList, textField } from './shared.js';

/** Viewer-facing ProgramGraph from axiom-api/src/runtime-graph.ts and axiom.org. */
export interface AxiomProgramGraph {
  rules: Array<{
    legalId: string; name: string; fileLegalId: string; kind: string | null;
    entity: string | null; dtype: string | null; period: string | null; unit: string | null;
    source: string | null; sourceUrl?: string | null; formula?: string | null;
    ruleDeps: string[]; inputDeps: string[]; relationDeps: string[];
    certificateId?: string; certificationStatus?: string; incompleteByDeclaration?: boolean;
  }>;
  inputs: Array<{ legalId: string; name: string; fileLegalId: string; sample?: unknown; entity?: string | null; relationLegalId?: string | null }>;
  relations: Array<{ legalId: string; name: string; fileLegalId: string; memberInputIds?: string[] }>;
  ownOutputs: string[];
  terminalOutputs: string[];
}

export interface AxiomAdapterOptions {
  id?: string;
  title?: string;
  /** Immutable source snapshot revision, never inferred from a certificate ID. */
  revision?: string;
  nodeRevisions?: Record<string, string>;
  sources?: SourceRef[];
  provenance?: Record<string, JsonValue>;
}

/** Pure projection; no compilation, evaluation, certificate verification, or network access. */
export function fromAxiomProgramGraph(input: AxiomProgramGraph, options: AxiomAdapterOptions = {}): GraphDocument {
  const graph = jsonObject(input, 'Axiom ProgramGraph');
  for (const field of ['rules', 'inputs', 'relations']) if (!Array.isArray(graph[field])) throw new Error(`Axiom ${field} must be an array`);
  const ownOutputs = stringList(graph.ownOutputs, 'ownOutputs');
  const terminalOutputs = stringList(graph.terminalOutputs, 'terminalOutputs');
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const missing = new Set<string>();
  const insert = (raw: unknown, kind: string) => {
    const data = jsonObject(raw, `Axiom ${kind}`);
    const id = textField(data.legalId, 'legalId');
    if (nodes.has(id)) throw new Error(`Duplicate Axiom legalId: ${id}`);
    const node: GraphNode = {
      id, label: textField(data.name, 'name'), kind,
      ...(options.nodeRevisions?.[id] ? { revision: options.nodeRevisions[id] } : {}),
      data: { ...data, ownOutput: ownOutputs.includes(id), terminalOutput: terminalOutputs.includes(id) },
      sources: [...sourceRef(typeof data.source === 'string' ? data.source : null, typeof data.sourceUrl === 'string' ? data.sourceUrl : null), ...(options.sources ?? [])],
      statuses: [],
    };
    if (typeof data.certificationStatus === 'string') node.statuses!.push({ label: `Declared certification: ${data.certificationStatus}`, tone: 'neutral' });
    if (data.certificateId) node.statuses!.push({ label: 'Certificate referenced; not verified', tone: 'neutral' });
    if (data.incompleteByDeclaration === true) node.statuses!.push({ label: 'Incomplete by declaration', tone: 'warning' });
    nodes.set(id, node);
  };
  for (const raw of graph.rules as JsonValue[]) {
    const rule = jsonObject(raw, 'rule');
    insert(rule, typeof rule.kind === 'string' ? rule.kind : 'rule');
  }
  for (const raw of graph.inputs as JsonValue[]) insert(raw, 'input');
  for (const raw of graph.relations as JsonValue[]) insert(raw, 'relation');

  const ensure = (id: string, expectedKind: string) => {
    if (nodes.has(id)) return;
    missing.add(id);
    nodes.set(id, { id, label: id, kind: expectedKind, data: { evidenceAvailability: 'record_not_supplied' }, statuses: [{ label: 'Referenced node not supplied', tone: 'warning' }] });
  };
  const link = (source: string, target: string, kind: string, sourceField: string, expectedKind: string) => {
    ensure(source, expectedKind);
    const id = edgeId(source, target, kind);
    if (edges.has(id)) return;
    edges.set(id, { id, source, target, kind, category: 'dependency', label: kind.replaceAll('_', ' '), data: { sourceField, evidence: 'declared_dependency' } });
  };
  for (const raw of graph.rules as JsonValue[]) {
    const rule = jsonObject(raw, 'rule');
    for (const [field, kind, expected] of [['ruleDeps', 'rule_dependency', 'rule'], ['inputDeps', 'input_dependency', 'input'], ['relationDeps', 'relation_dependency', 'relation']]) {
      for (const id of stringList(rule[field], field)) link(id, rule.legalId as string, kind, field, expected);
    }
  }
  for (const raw of graph.relations as JsonValue[]) {
    const relation = jsonObject(raw, 'relation');
    for (const id of stringList(relation.memberInputIds ?? [], 'memberInputIds')) link(id, relation.legalId as string, 'relation_member_input', 'memberInputIds', 'input');
  }
  for (const raw of graph.inputs as JsonValue[]) {
    const node = jsonObject(raw, 'input');
    if (typeof node.relationLegalId === 'string') {
      ensure(node.relationLegalId, 'relation');
      link(node.legalId as string, node.relationLegalId, 'relation_member_input', 'relationLegalId', 'input');
    }
  }
  for (const id of [...ownOutputs, ...terminalOutputs]) ensure(id, 'rule');
  return {
    schemaVersion: 'graph-explorer/v1', id: options.id ?? 'axiom-program-graph', title: options.title ?? 'Axiom program graph',
    ...(options.revision ? { revision: options.revision } : {}),
    description: 'Declared Axiom rule dependencies. This view does not evaluate rules or verify certificates.',
    nodes: [...nodes.values()], edges: [...edges.values()],
    metadata: { adapter: 'axiom/ProgramGraph', ownOutputs, terminalOutputs, missingNodeIds: [...missing], ...(options.provenance ? { provenance: options.provenance } : {}) },
  };
}
