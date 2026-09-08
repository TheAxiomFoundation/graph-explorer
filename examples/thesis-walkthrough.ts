import type { ActivityRecord, ArtifactRef, GraphDocument, GraphEdge, GraphLocation, GraphNode, JsonValue } from '../src/core/types.js';
import { parseGraphDocument } from '../src/core/index.js';
import publication from './thesis-walkthrough-publication.json';

// This is an example projection of Thesis's public conditional API, not an
// invented scientific-record envelope or a replacement forecasting engine.
const [original, revised] = publication.details;
const contract = revised.contract;
const repository = publication.source.repository;
const blobRoot = `${repository}/blob/${publication.source.commit}/${publication.source.publicationPath}/blobs/`;
const rawRoot = `${repository.replace('github.com', 'raw.githubusercontent.com')}/${publication.source.commit}/${publication.source.publicationPath}/blobs/`;
const nativeUrl = (id: string) => `${repository}/blob/${publication.source.commit}/${publication.source.publicationPath}/blobs/${publication.source.projections[id as keyof typeof publication.source.projections].sha256}`;
const nested = (parent: string, type: string, id?: string | number) => JSON.stringify([parent, type, ...(id === undefined ? [] : [id])]);
const sourceId = (id: string) => nested(revised.contract_id, 'source', id);
const historyId = (period: string) => nested(revised.contract_id, 'history', period);
const json = (value: unknown): { [key: string]: JsonValue } => JSON.parse(JSON.stringify(value));
const subject = (node: GraphNode) => ({ type: 'node' as const, id: node.id, revision: node.revision });
const artifactUrl = (sha: string) => `${rawRoot}${sha}`;
const citationExtraction = {
  fields: ['response.reference_reasoning', 'response.arms[].reasoning'],
  rule: 'Exact known source IDs inside square brackets, including comma-separated IDs; no natural-language citation inference',
  absenceMeaning: 'No recognized bracketed source ID in this reasoning; this does not establish that no sources were cited or used',
};
function citedSourceIds(reasoning: string): string[] {
  const tokens = new Set([...reasoning.matchAll(/\[([^\]]+)\]/g)].flatMap(match => match[1].split(',').map(token => token.trim())));
  return contract.sources.filter(source => tokens.has(source.id)).map(source => source.id);
}

export const thesisWalkthroughDescription = 'Trace a recorded Gemini forecast from public education evidence through review and revision.';
export const thesisWalkthroughCaveat = 'Exploratory · source-review issues remain. No automatic resolver, prospective rank, causal-effect claim or verified Receipt.';

function project(includeRevision: boolean): GraphDocument {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const activities: ActivityRecord[] = [];
  const artifacts = new Map<string, ArtifactRef>();
  const addNode = (node: GraphNode) => { nodes.push(node); return node; };
  const addEdge = (source: string, target: string, kind: string, label: string, category: GraphEdge['category'] = 'dependency', data?: GraphEdge['data']) => {
    edges.push({ id: JSON.stringify([source, target, kind]), source, target, kind, label, category, ...(data ? { data } : {}) });
  };
  const addArtifact = (ref: { sha256: string; media_type: string; role?: string }, label?: string) => {
    artifacts.set(ref.sha256, { id: ref.sha256, sha256: ref.sha256, mediaType: ref.media_type, label: label ?? artifacts.get(ref.sha256)?.label ?? ref.role ?? ref.sha256.slice(0, 12), uri: artifactUrl(ref.sha256) });
  };
  const addReasoningCitations = (target: string, ids: string[], nativePath: string) => {
    for (const id of ids) addEdge(sourceId(id), target, 'response_source_citation', 'cited in reasoning', 'evidence', { evidenceRole: 'cited', nativePath });
  };
  addNode({ id: revised.contract_id, revision: revised.contract_id, label: '2030 mathematics · exact question', kind: 'conditional_contract', description: contract.question, data: { record: json(contract), nativePath: "contract", artifactIds: [revised.contract_id] }, sources: [{ label: 'Native frozen contract', url: `${blobRoot}${revised.contract_id}`, sha256: revised.contract_id }], statuses: [{ label: 'Exploratory · not registered', tone: 'warning' }, { label: 'Release day not established', tone: 'neutral' }] });
  addNode({ id: revised.shared_evidence_id, revision: revised.shared_evidence_id, label: 'Shared evidence packet', kind: 'shared_evidence', description: 'The same frozen source packet was supplied to both attempts. Provision does not establish consumption of every source.', data: { historyCount: contract.shared_history.length, claimCount: contract.shared_evidence.length, sourceCount: contract.sources.length, evidenceRole: 'provided', nativeIdentity: revised.shared_evidence_id, nativePaths: ["contract.sources", "contract.shared_history", "contract.shared_evidence"] }, statuses: [{ label: 'Frozen inputs · local operator', tone: 'neutral' }] });
  addEdge(revised.contract_id, revised.shared_evidence_id, 'defines_evidence_scope', 'defines evidence scope', 'reference');
  for (const [sourceIndex, source] of contract.sources.entries()) {
    addArtifact(source.artifact, source.title);
    addNode({ id: sourceId(source.id), revision: source.artifact.sha256, label: source.title, kind: 'public_source', description: 'Public source bytes captured by the Thesis operator; original retrieval and timing are not independently attested here.', data: { record: json(source), artifactIds: [source.artifact.sha256], nativeSourceId: source.id, nativePath: `contract.sources[${sourceIndex}]` }, sources: [{ label: 'Original public source', url: source.url }, { label: 'Pinned captured bytes', url: artifactUrl(source.artifact.sha256), sha256: source.artifact.sha256 }] });
    addEdge(sourceId(source.id), revised.shared_evidence_id, 'source_in_packet', 'included in packet', 'evidence', { evidenceRole: 'provided' });
  }
  for (const [historyIndex, row] of contract.shared_history.entries()) {
    addNode({ id: historyId(row.period), revision: revised.contract_id, label: `${row.period} · ${Number(row.value.toFixed(2))} NAEP points`, kind: 'historical_observation', data: json({ ...row, nativePath: `contract.shared_history[${historyIndex}]`, vintage: 'current-vintage capture; historical first print not established' }), sources: [{ label: 'Captured official history', url: artifactUrl(contract.sources.find(s => s.id === row.source_id)!.artifact.sha256) }] });
    addEdge(sourceId(row.source_id), historyId(row.period), 'history_source', 'recorded source', 'evidence');
    addEdge(historyId(row.period), revised.shared_evidence_id, 'history_in_packet', 'included history', 'evidence', { evidenceRole: 'provided' });
  }
  contract.shared_evidence.forEach((claim, index) => {
    const id = nested(revised.contract_id, 'claim', index);
    const claimLabels = ['Exact student population', 'Historical values and vintage', 'Release schedule and framework', 'Captured bill status', 'Proposed grants and funding', 'Supplement-not-supplant rule', 'Indonesia salary experiment', 'Texas retention study'];
    addNode({ id, revision: revised.contract_id, label: claimLabels[index] ?? `Evidence statement ${index + 1}`, kind: 'evidence_statement', description: claim.claim, data: json({ ...claim, nativePath: `contract.shared_evidence[${index}]` }), statuses: [{ label: 'Operator-authored source statement', tone: 'neutral' }] });
    for (const source of claim.source_ids) addEdge(sourceId(source), id, 'statement_source', 'cited by statement', 'evidence', { evidenceRole: 'cited' });
    addEdge(id, revised.shared_evidence_id, 'statement_in_packet', 'included statement', 'evidence', { evidenceRole: 'provided' });
  });

  const attempts = includeRevision ? [original, revised] : [original];
  for (const detail of attempts) {
    for (const ref of detail.artifacts) addArtifact(ref);
    const isRevised = detail.id === revised.id;
    const response = detail.response;
    const refId = nested(detail.id, 'reference');
    const referenceSources = citedSourceIds(response.reference_reasoning);
    const resultHash = detail.artifacts.find(a => a.role === 'result')!.sha256;
    const run = addNode({ id: detail.id, revision: resultHash, label: isRevised ? 'Gemini · revised attempt' : 'Gemini · original attempt', kind: 'conditional_attempt', description: 'Recorded execution succeeded; source and arithmetic review still has unresolved findings.', data: json({ nativeAttemptId: detail.id, nativePath: "$", requestedModel: detail.requested_model, observedModel: detail.observed_model, providerMetadata: detail.provider_metadata, startedAt: detail.started_at, finishedAt: detail.finished_at, executionState: detail.execution_state, scoringStatus: detail.scoring_status, trustClass: detail.trust_class, artifactIds: detail.artifacts.map(a => a.sha256) }), sources: [{ label: 'Complete native public projection', url: nativeUrl(detail.id) }], statuses: [{ label: 'Source-review issues remain', tone: 'warning' }, { label: 'Execution succeeded', tone: 'neutral' }] });
    addEdge(revised.contract_id, detail.id, 'attempt_contract', 'frozen question', 'dependency');
    addEdge(revised.shared_evidence_id, detail.id, 'attempt_evidence_provided', 'evidence supplied', 'evidence', { evidenceRole: 'provided' });
    addNode({ id: refId, revision: resultHash, label: `${isRevised ? 'Revised' : 'Original'} reference · ${detail.reference_quantiles.q50}`, kind: 'reference_forecast', description: response.reference_reasoning, data: json({ distribution: response.reference, quantiles: detail.reference_quantiles, nativePath: 'response.reference', nativeReasoningPath: 'response.reference_reasoning', literalCitedSourceIds: referenceSources, citationExtraction, attemptId: detail.id, interpretation: 'Shared modeling baseline; not an unconditional mixture of the arms' }) });
    addEdge(detail.id, refId, 'reported_reference', 'reported reference', 'provenance');
    addReasoningCitations(refId, referenceSources, 'response.reference_reasoning');
    const outputNodes: GraphNode[] = [run, nodes.find(n => n.id === refId)!];
    response.arms.forEach((arm, index) => {
      const spec = contract.arms[index];
      const q = detail.arm_quantiles[index];
      const armSources = citedSourceIds(arm.reasoning);
      const reasoningPath = `response.arms[${index}].reasoning`;
      const armNode = addNode({ id: nested(detail.id, 'arm', arm.id), revision: resultHash, label: `${spec.label} · ${q.q50}`, kind: 'conditional_forecast', description: arm.reasoning, data: json({ condition: spec.condition, assumptions: spec.assumptions, quantiles: q, baselineDelta: arm.baseline_delta, distribution: arm.distribution, nativeArmId: arm.id, nativePath: `response.arms[${index}]`, nativeReasoningPath: reasoningPath, literalCitedSourceIds: armSources, citationExtraction, attemptId: detail.id, unit: detail.unit }), statuses: [{ label: 'Exploratory · issues remain', tone: 'warning' }] });
      outputNodes.push(armNode);
      addEdge(detail.id, armNode.id, 'reported_conditional', 'reported forecast', 'provenance');
      addEdge(refId, armNode.id, 'shared_reference_adjustment', `reference adjustment ${arm.baseline_delta >= 0 ? '+' : ''}${arm.baseline_delta}`, 'dependency', { baselineDelta: arm.baseline_delta, interpretation: 'Recorded forecast adjustment; no identified causal effect' });
      addReasoningCitations(armNode.id, armSources, reasoningPath);
    });
    activities.push({ id: nested(detail.id, 'execution'), label: isRevised ? 'Recorded revised Gemini execution' : 'Recorded original Gemini execution', kind: 'execution', revision: resultHash, agent: { name: 'Gemini operator transport', model: detail.requested_model }, startedAt: detail.started_at, endedAt: detail.finished_at, inputs: [{ subject: { type: 'node', id: revised.contract_id, revision: revised.contract_id }, role: 'provided' }, { subject: { type: 'node', id: revised.shared_evidence_id, revision: revised.shared_evidence_id }, role: 'provided' }], outputs: outputNodes.map(subject), artifactIds: detail.artifacts.map(a => a.sha256), data: { observedModel: null, providerMetadata: json(detail.provider_metadata), origin: 'operator-recorded; provider envelope matched to response, not independently attested', consumptionEvidence: 'not inferred' } });
    for (const [reviewIndex, review] of detail.reviews.entries()) {
      addArtifact(review.record_artifact); addArtifact(review.report);
      addNode({ id: review.id, revision: review.id, label: `${isRevised ? 'Revised' : 'Original'} review · ${review.findings.length} findings`, kind: 'source_review', description: review.findings.map(f => `${f.title}: ${f.detail}`).join('\n\n'), data: json({ record: review, nativePath: `reviews[${reviewIndex}]`, attemptId: detail.id, artifactIds: [review.id, review.report.sha256] }), sources: [{ label: 'Complete source review', url: artifactUrl(review.report.sha256), sha256: review.report.sha256 }], statuses: [{ label: 'Issues remain · operator assessment', tone: 'warning' }] });
      addEdge(detail.id, review.id, 'reviewed_attempt', 'reviewed response', 'provenance');
      const cited = new Set(review.findings.flatMap(f => f.source_ids));
      for (const source of cited) addEdge(sourceId(source), review.id, 'review_source_reference', 'checked against source', 'evidence', { evidenceRole: 'cited' });
      activities.push({ id: nested(review.id, 'review'), label: review.reviewer, kind: 'review', revision: review.id, agent: { name: review.reviewer }, inputs: [{ subject: subject(run), role: 'provided' }], outputs: [{ type: 'node', id: review.id, revision: review.id }], artifactIds: [review.id, review.report.sha256], data: { reviewBasis: review.review_basis, operatorRecordedAt: review.recorded_at, timingScope: 'Retrospective record time; not proof of assessment before execution' } });
    }
  }
  if (includeRevision) {
    const link = revised.revision_history.find(item => item.parent_attempt_id)!;
    const revisionId = link.association_artifact!.sha256;
    const feedbackId = link.feedback!.sha256;
    addArtifact(link.association_artifact!); addArtifact(link.feedback!);
    addNode({ id: feedbackId, revision: feedbackId, label: 'Feedback supplied for revision', kind: 'revision_feedback', data: json({ artifactIds: [feedbackId], evidenceRole: 'provided' }), sources: [{ label: 'Exact archived feedback', url: artifactUrl(feedbackId), sha256: feedbackId }] });
    addNode({ id: revisionId, revision: revisionId, label: 'Original → revised comparison', kind: 'revision_association', description: 'The original and revised attempts share the exact contract and evidence. The link was recorded retrospectively; it does not establish review timing or causal correctness.', data: json({ record: link, nativePath: `revision_history[${revised.revision_history.indexOf(link)}]`, original: { attemptId: original.id, reference: original.reference_quantiles, arms: original.arm_quantiles }, revised: { attemptId: revised.id, reference: revised.reference_quantiles, arms: revised.arm_quantiles }, artifactIds: [revisionId, feedbackId] }), statuses: [{ label: 'Retrospective association', tone: 'neutral' }] });
    addEdge(original.id, revisionId, 'revision_parent', 'original attempt', 'provenance');
    addEdge(link.triggering_review_id!, revisionId, 'revision_triggering_review', 'associated review', 'provenance');
    addEdge(revisionId, revised.id, 'revision_child', 'revised attempt', 'provenance');
    addEdge(link.triggering_review_id!, feedbackId, 'revision_feedback_from_review', 'revision feedback', 'provenance');
    addEdge(feedbackId, revised.id, 'revision_feedback_provided', 'feedback supplied', 'evidence', { evidenceRole: 'provided' });
    activities.find(a => a.id === nested(revised.id, 'execution'))!.inputs!.push({ subject: { type: 'node', id: feedbackId, revision: feedbackId }, role: 'provided' });
  }
  return parseGraphDocument({ schemaVersion: 'graph-explorer/v1', id: 'thesis-teacher-pay-walkthrough', title: 'Teacher pay and mathematics · recorded Thesis forecasts', description: `${thesisWalkthroughDescription} ${thesisWalkthroughCaveat}`, revision: includeRevision ? revised.id : original.id, nodes, edges, activities, artifacts: [...artifacts.values()], receipts: [], metadata: { provenance: json(publication.source), projection: 'thesis/public-conditional-walkthrough-v1', snapshotMeaning: includeRevision ? 'Original, reviews and revised attempt together' : 'Original-attempt subset of the same later public snapshot; not a claim of earlier publication', fullPublicDetails: attempts.map(d => ({ id: d.id, url: nativeUrl(d.id) })), receiptAvailability: 'not_provided', limitations: contract.limitations, citationExtraction, artifactAvailability: 'public links; bytes not embedded in offline export', immutableIds: 'Native top-level IDs retained; nested fields namespace native parent identity and field path' } });
}

export const thesisWalkthroughBaseline = project(false);
export const thesisWalkthrough = project(true);
export const thesisWalkthroughLocation: GraphLocation = { selectedId: nested(revised.id, 'arm', 'enacted'), selectedType: 'node', focusId: revised.id, direction: 'both', depth: 1 };
export const thesisWalkthroughSteps = [
  { label: 'Inspect the 2024 evidence', selectedId: historyId('2024'), focusId: revised.shared_evidence_id, description: 'Current-vintage official history supplied to both attempts.' },
  { label: 'Trace the revised forecast', selectedId: nested(revised.id, 'arm', 'enacted'), focusId: revised.id, description: 'The agent’s original CDF, assumptions and source citations.' },
  { label: 'Read the unresolved review', selectedId: revised.reviews[0].id, focusId: revised.id, description: 'Three source and arithmetic findings remain visible.' },
  { label: 'Compare the two attempts', selectedId: revised.revision_history.find(item => item.parent_attempt_id)!.association_artifact!.sha256, focusId: revised.id, description: 'Original and revised quantiles, exact feedback and retrospective lineage.' },
] as const;
