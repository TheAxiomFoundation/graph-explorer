import { parseGraphDocument } from '../src/core/index.js';
import type { ArtifactRef, GraphDocument, GraphEdge, GraphLocation, GraphNode, JsonValue, SourceRef } from '../src/core/types.js';
import source from './mars-signal-horizons.json';
import execution from './mars-axiom-run.json';
import checks from './mars-signal-checks.json';
import publicArtifacts from './mars-signal-public-artifacts.json';

export interface MarsSignalArtifact {
  sourcePath: string;
  sha256: string;
  extension: 'json' | 'txt' | 'yaml';
  byteLength: number;
  role: string;
}
export const marsSignalArtifacts = publicArtifacts as readonly MarsSignalArtifact[];
const artifactRoot = 'https://theaxiomfoundation.github.io/orrery/artifacts/mars/';
const id = (name: string) => `mars-signal/${name}`;
const json = (value: unknown): { [key: string]: JsonValue } => JSON.parse(JSON.stringify(value));
const url = (artifact: { sha256: string; extension: string }) => `${artifactRoot}${artifact.sha256}.${artifact.extension}`;
const artifactFor = (path: string) => {
  const artifact = marsSignalArtifacts.find(item => item.sourcePath === path);
  if (!artifact) throw new Error(`Missing public Mars artifact: ${path}`);
  return artifact;
};
const captureFor = (file: string) => artifactFor(`examples/${file}`);
const capturedSource = (artifact: { sha256: string; extension: string }, label: string): SourceRef => ({ label, url: url(artifact), sha256: artifact.sha256 });
const constantArtifact = captureFor(source.speedOfLight.capture.file);
const checkArtifact = artifactFor('examples/mars-signal-checks.json');
const sourceScript = artifactFor('examples/mars-signal-capture.py');
const nativeScript = artifactFor('examples/mars-axiom-capture.py');
const checkScript = artifactFor('examples/mars-signal-check.py');
const artifacts: ArtifactRef[] = marsSignalArtifacts.map(artifact => ({
  id: artifact.sha256, label: artifact.role, sha256: artifact.sha256, uri: url(artifact),
  mediaType: artifact.extension === 'json' ? 'application/json' : 'text/plain',
}));

const caveat = 'Recorded JPL ephemeris and native Axiom calculation. This divides the planets’ same-epoch center-to-center separation by light speed, holding positions fixed. It does not solve motion during transit or include surface-station, gravitational, atmospheric, relay, processing or scheduling delays. No live data, network latency measurement or verified Receipt is implied.';

/** Presentation rounding only; the scientific result is the native Axiom output. */
function answerLabel(seconds: string): string {
  const rounded = Math.round(Number(seconds));
  return `${Math.floor(rounded / 60)} min ${rounded % 60} sec`;
}

function project(index: number): GraphDocument {
  const snapshot = source.snapshots[index];
  const run = execution.runs.find(item => item.epoch === snapshot.epoch)!;
  const check = checks.checks.find(item => item.epoch === snapshot.epoch)!;
  const checkRevision = `${checkArtifact.sha256}:${snapshot.epoch}`;
  const horizonArtifact = captureFor(snapshot.capture.file);
  const dateLabel = new Date(snapshot.epoch).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const nodes: GraphNode[] = [
    { id: id('earth'), label: 'Earth', kind: 'origin', description: 'Earth’s center is the origin of the relative position vector.', data: { nativeBodyId: '399', center: '500@399', location: 'Body center; no surface station' }, sources: [{ label: 'Horizons center selection', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html#center-parameter' }] },
    { id: id('mars'), label: 'Mars', kind: 'destination', description: 'Mars’s center is the target body. Both positions use the same epoch.', data: { nativeBodyId: '499', command: '499', location: 'Planet center; not Mars system barycenter' }, sources: [{ label: 'Horizons major-body IDs', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html#command-parameter' }] },
    { id: id('epoch'), revision: snapshot.epoch, label: dateLabel, kind: 'date', description: 'The modeled instant is 00:00 UTC. Source retrieval and calculation happened later and have separate timestamps.', data: { epoch: snapshot.epoch, julianDayUT: snapshot.values.julianDayUT, returnedCalendarDate: snapshot.values.calendarDateUT, inputTimeType: 'UT', interpretation: source.timeScale, tdbMinusUTSeconds: snapshot.values.tdbMinusUTSeconds } },
    { id: id('horizons'), revision: horizonArtifact.sha256, label: 'JPL Horizons', kind: 'source', description: 'Recorded geometric Mars position relative to Earth from JPL’s ephemeris service.', data: json({ requestParameters: snapshot.parameters, returnedValues: snapshot.values, apiSignature: snapshot.signature, targetEphemeris: snapshot.targetEphemeris, centerEphemeris: snapshot.centerEphemeris, eopFile: snapshot.eopFile, retrieval: snapshot.capture, geometry: source.geometry, artifactIds: [horizonArtifact.sha256], rawField: 'result: CSV row between $$SOE and $$EOE' }), sources: [capturedSource(horizonArtifact, 'Exact captured JPL response'), { label: 'Reproduce the query · live response may differ', url: snapshot.capture.url }, { label: 'Horizons API documentation', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html' }] },
    { id: id('distance'), revision: horizonArtifact.sha256, label: `${(Number(run.inputRangeKm) / 1e6).toFixed(1)} million km`, kind: 'distance', description: 'Geometric center-to-center separation at the recorded date.', data: { kilometers: run.inputRangeKm, originalJplValue: snapshot.values.rangeKm, rawField: 'RG', derivation: 'Transcribed from captured Horizons range; scientific notation converted losslessly to decimal', unit: 'km', artifactIds: [horizonArtifact.sha256] }, sources: [capturedSource(horizonArtifact, 'Recorded range and position vector')] },
    { id: id('light-speed'), revision: constantArtifact.sha256, label: '299,792.458 km/s', kind: 'constant', description: 'The exact SI speed of light in vacuum, expressed in kilometres per second.', data: json({ kilometersPerSecond: source.speedOfLight.kilometersPerSecond, metersPerSecond: source.speedOfLight.metersPerSecond, exact: true, conversion: '1 km = 1000 m exactly', retrieval: source.speedOfLight.capture, artifactIds: [constantArtifact.sha256] }), sources: [capturedSource(constantArtifact, 'Captured NIST page · original bytes as inert text'), { label: 'NIST speed of light', url: source.speedOfLight.capture.url }] },
    { id: id('assumptions'), label: 'Hold positions fixed', kind: 'assumption', description: 'A simple one-way estimate uses distance at one instant. It does not solve for Mars’s later position when an outgoing message arrives.', data: { calculation: 'same-epoch geometric range / vacuum light speed', limitations: caveat, omitted: ['planetary motion during transit', 'surface-station offsets', 'gravitational propagation corrections', 'atmosphere and plasma', 'relay, processing and scheduling delays'], distinction: 'Horizons observer down-leg light-time describes received light from a target; it is not the outbound transmission modeled here.' }, sources: [{ label: 'Horizons geometric and observer light-time conventions', url: 'https://ssd.jpl.nasa.gov/horizons/manual.html' }] },
    { id: id('calculation'), revision: run.responseArtifact.sha256, label: 'Distance ÷ light speed', kind: 'calculation', description: 'Executed by the real Axiom rules engine from a small astronomy RuleSpec module.', data: json({ expression: 'range_km / speed_of_light_km_per_second', nativeInputId: execution.moduleTarget + '#input.range_km', nativeOutputId: execution.moduleTarget + '#fixed_position_one_way_seconds', inputRangeKm: run.inputRangeKm, speedOfLightKmPerSecond: execution.speedOfLightKmPerSecond, returnedSeconds: run.seconds, returnedMinutes: run.minutes, runtime: execution.runtime, nativeRequest: run.request, nativeResponse: run.response, assurance: execution.assurance, moduleMeaning: execution.moduleMeaning, artifactIds: [execution.moduleArtifact.sha256, execution.compiledArtifact.sha256, run.requestArtifact.sha256, run.responseArtifact.sha256] }), sources: [capturedSource(execution.moduleArtifact, 'Astronomy RuleSpec module'), capturedSource(run.requestArtifact, 'Exact native execution input'), capturedSource(run.responseArtifact, 'Native Axiom result and trace'), { label: 'Pinned public Axiom runtime source', url: `${execution.runtime.repository}/tree/${execution.runtime.revision}` }] },
    { id: id('answer'), revision: run.responseArtifact.sha256, label: `About ${answerLabel(run.seconds)}`, kind: 'answer', description: 'Estimated one-way light travel from Earth to Mars at this separation.', data: { seconds: run.seconds, minutes: run.minutes, roundedDisplay: answerLabel(run.seconds), rounding: 'Nearest whole second; original native decimal result preserved', epoch: snapshot.epoch, scope: 'Fixed-position vacuum estimate; not retarded outgoing light-time or network latency', artifactIds: [run.responseArtifact.sha256] }, sources: [capturedSource(run.responseArtifact, 'Recorded native result')] },
    { id: id('check'), revision: checkRevision, label: 'Numerical checks pass', kind: 'check', description: 'Checks preserve the inputs and compare native arithmetic with the recorded JPL values. This does not independently verify the astronomy.', data: json({ ...check, method: checks.method, scope: checks.scope, artifactIds: [checkArtifact.sha256, checkScript.sha256] }), sources: [capturedSource(checkArtifact, 'Recorded numerical and byte checks'), capturedSource(checkScript, 'Exact check script')] },
  ];
  const connections: [string, string, string, string, GraphEdge['category']][] = [
    ['earth', 'horizons', 'coordinate_origin', 'origin', 'reference'],
    ['mars', 'horizons', 'target_body', 'target', 'reference'],
    ['epoch', 'horizons', 'ephemeris_epoch', 'at this date', 'dependency'],
    ['horizons', 'distance', 'reported_geometric_range', 'reported range', 'evidence'],
    ['distance', 'calculation', 'division_numerator', 'distance', 'dependency'],
    ['light-speed', 'calculation', 'division_denominator', 'speed', 'dependency'],
    ['assumptions', 'calculation', 'model_scope', 'approximation', 'reference'],
    ['calculation', 'answer', 'native_calculation_output', 'returned result', 'provenance'],
    ['horizons', 'check', 'numerical_reference', 'cross-check values', 'evidence'],
    ['calculation', 'check', 'checked_native_result', 'checked output', 'provenance'],
    ['check', 'answer', 'numerical_agreement', 'consistent arithmetic', 'provenance'],
  ];
  // The shared canvas displays kind. Keep stable edge IDs while spelling this
  // demo's exact relationship meanings as readable phrases.
  const edges = connections.map(([from, to, kind, label, category]) => ({ id: id(`edge/${kind}`), source: id(from), target: id(to), kind: kind.replaceAll('_', ' '), label, category }));
  const subject = (name: string) => { const node = nodes.find(item => item.id === id(name))!; return { type: 'node' as const, id: node.id, ...(node.revision ? { revision: node.revision } : {}) }; };
  return parseGraphDocument({
    schemaVersion: 'graph-explorer/v1', id: 'mars-signal', revision: run.responseArtifact.sha256,
    title: 'How long would a message take to reach Mars?', description: 'Trace a recorded Earth–Mars distance through an Axiom calculation to a one-way light travel estimate.', nodes, edges, artifacts, receipts: [],
    activities: [
      { id: id('activity/horizons-capture'), kind: 'import', label: 'Capture and parse the JPL response', revision: horizonArtifact.sha256, agent: { name: 'Orrery public-source capture script', version: sourceScript.sha256 }, startedAt: snapshot.capture.retrievalStartedAt, endedAt: snapshot.capture.retrievedAt, inputs: ['earth', 'mars', 'epoch'].map(name => ({ subject: subject(name), role: 'provided' as const })), outputs: [subject('horizons'), subject('distance')], artifactIds: [horizonArtifact.sha256, sourceScript.sha256], data: { method: 'Documented public HTTPS GET and CSV extraction', timestampScope: snapshot.capture.timestampScope } },
      { id: id('activity/constant-capture'), kind: 'import', label: 'Capture the exact SI constant', revision: constantArtifact.sha256, agent: { name: 'Orrery public-source capture script', version: sourceScript.sha256 }, startedAt: source.speedOfLight.capture.retrievalStartedAt, endedAt: source.speedOfLight.capture.retrievedAt, outputs: [subject('light-speed')], artifactIds: [constantArtifact.sha256, sourceScript.sha256], data: { timestampScope: source.speedOfLight.capture.timestampScope } },
      { id: id('activity/axiom-calculation'), kind: 'execution', label: 'Run the native Axiom calculation', revision: run.responseArtifact.sha256, agent: { name: 'Axiom rules engine', version: execution.runtime.capabilities.engine.version }, startedAt: run.startedAt, endedAt: run.endedAt, inputs: ['distance', 'light-speed', 'assumptions'].map(name => ({ subject: subject(name), role: 'provided' as const })), outputs: [subject('calculation'), subject('answer')], artifactIds: [execution.moduleArtifact.sha256, execution.bundleArtifact.sha256, execution.compiledArtifact.sha256, run.requestArtifact.sha256, run.responseArtifact.sha256, nativeScript.sha256], data: { nativeCoreRevision: execution.runtime.revision, nativeEngineRevision: execution.runtime.capabilities.engine.revision, assurance: execution.assurance, timestampScope: execution.timestampScope } },
      { id: id('activity/numerical-check'), kind: 'review', label: 'Check captured bytes and numerical agreement', revision: checkRevision, agent: { name: 'Python numerical-check script', version: checks.pythonVersion }, startedAt: checks.startedAt, endedAt: checks.endedAt, inputs: ['horizons', 'distance', 'light-speed', 'calculation'].map(name => ({ subject: subject(name), role: 'provided' as const })), outputs: [subject('check')], artifactIds: [checkArtifact.sha256, checkScript.sha256], data: { scope: checks.scope, timestampScope: 'Local process clock; not independently attested' } },
    ],
    metadata: { modeledEpoch: snapshot.epoch, retrievedAt: snapshot.capture.retrievedAt, executedAt: run.startedAt, checkedAt: checks.endedAt, interpretation: 'Geometric range/c with fixed positions', direction: 'One-way Earth-to-Mars approximation; outgoing moving-target propagation not solved', comparisonMeaning: 'Different modeled dates captured and executed in the same later session; no earlier publication implied', receiptAvailability: 'not_provided', sourceFixtureSha256: execution.sourceFixtureSha256, artifactAvailability: 'Separate captured public bytes; offline reports retain references and do not fetch them automatically' },
  });
}

const current = project(0);
const earlier = project(1);
const guide = [
  { label: 'See the answer', description: 'A one-way estimate from the actual Axiom result.', selectedId: id('answer'), focusId: id('calculation') },
  { label: 'Inspect the source', description: 'The captured JPL response, exact settings and returned range.', selectedId: id('horizons'), focusId: id('horizons') },
  { label: 'Follow the calculation', description: 'The RuleSpec module, native input and Axiom execution trace.', selectedId: id('calculation'), focusId: id('calculation') },
  { label: 'Check the work', description: 'Recorded byte and numerical consistency checks, with their limits.', selectedId: id('check'), focusId: id('calculation') },
];

export interface MarsSignalExample {
  id: 'mars' | 'mars-comparison';
  label: string;
  summary: string;
  document: GraphDocument;
  baseline?: GraphDocument;
  location: GraphLocation;
  guide: typeof guide;
  caveat: string;
  caveatSummary: string;
  spotlight: { question: string; answer: string; dateLabel: string; scope: string };
}

export const marsSignalExamples: readonly MarsSignalExample[] = [current, earlier].map((document, index) => {
  const run = execution.runs.find(item => item.epoch === source.snapshots[index].epoch)!;
  const date = new Date(run.epoch).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return {
    id: index === 0 ? 'mars' : 'mars-comparison', label: `Mars · ${date}`, summary: 'Trace a recorded JPL distance through a native Axiom calculation to a one-way light travel estimate.',
    document, ...(index === 0 ? { baseline: earlier } : {}), location: { selectedId: id('answer'), selectedType: 'node', focusId: id('calculation'), direction: 'both', depth: 3 }, guide, caveat, caveatSummary: 'About this estimate',
    spotlight: { question: document.title, answer: answerLabel(run.seconds), dateLabel: `${date} · 00:00 UTC`, scope: 'One-way light travel estimate; excludes relay and processing delays.' },
  };
});
