/** Portable graph snapshot. Domain engines remain the authority for meaning and evaluation. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SourceRef {
  label: string;
  /** http(s), a fragment, or a relative artifact path. Never executable URLs. */
  url?: string;
  sha256?: string;
}

export interface StatusBadge {
  label: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}

export interface GraphNode {
  /** Stable identity across snapshots; unique within a snapshot. */
  id: string;
  label: string;
  kind: string;
  /** An immutable domain revision identifier. Its presence alone proves nothing. */
  revision?: string;
  parentId?: string;
  description?: string;
  data?: { [key: string]: JsonValue };
  sources?: SourceRef[];
  /** Independent badges preserve distinctions such as cache status and gate status. */
  statuses?: StatusBadge[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  label?: string;
  revision?: string;
  /** Explicitly distinguish document structure from semantic relationships. */
  category?: 'dependency' | 'containment' | 'evidence' | 'provenance' | 'reference';
  description?: string;
  data?: { [key: string]: JsonValue };
  sources?: SourceRef[];
  statuses?: StatusBadge[];
}

export interface SubjectRef {
  type: 'node' | 'edge' | 'activity';
  id: string;
  revision?: string;
}

export interface ArtifactRef {
  id: string;
  label: string;
  uri?: string;
  sha256?: string;
  mediaType?: string;
}

export interface ActivityRecord {
  id: string;
  label: string;
  kind: 'authorship' | 'execution' | 'review' | 'import' | string;
  revision?: string;
  agent?: { name: string; model?: string; version?: string };
  startedAt?: string;
  endedAt?: string;
  inputs?: { subject: SubjectRef; role: 'provided' | 'cited' | 'consumed' }[];
  outputs?: SubjectRef[];
  artifactIds?: string[];
  data?: { [key: string]: JsonValue };
}

/** Receipt references are declarations, never verification verdicts. */
export interface ReceiptRef {
  id: string;
  label: string;
  subjects: SubjectRef[];
  artifactIds?: string[];
  uri?: string;
  sha256?: string;
  /** The adapter identifier; no commands or executable trust configuration in data. */
  verifier?: string;
}

export interface GraphDocument {
  schemaVersion: 'graph-explorer/v1';
  id: string;
  title: string;
  description?: string;
  revision?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  activities?: ActivityRecord[];
  artifacts?: ArtifactRef[];
  receipts?: ReceiptRef[];
  metadata?: { [key: string]: JsonValue };
}

/** Supplied separately by a trusted host/verifier, never accepted from GraphDocument JSON. */
export interface ReceiptAssessment {
  receiptId: string;
  status: 'verified' | 'failed' | 'unavailable' | 'unchecked';
  verifier: string;
  /** Exact bytes of the graph snapshot to which this assessment applies. */
  documentSha256: string;
  /** Verified release head digest; must equal ReceiptRef.sha256 for verified status. */
  receiptSha256?: string;
  /** Exact graph subject revisions; required by the host gate for verified assessments. */
  subjects?: SubjectRef[];
  /** Checked artifact bytes; association with subjects is host-declared, not semantic proof. */
  artifacts?: { id: string; sha256: string }[];
  checkedAt?: string;
  scope: string;
  detail?: string;
  /** Path or URL to the verifier's complete report, if available. */
  reportUri?: string;
}

export interface GraphLocation {
  selectedId?: string;
  selectedType?: 'node' | 'edge';
  focusId?: string;
  direction?: 'both' | 'upstream' | 'downstream';
  depth?: number;
  showContainment?: boolean;
  query?: string;
  kinds?: string[];
  collapsedIds?: string[];
}
