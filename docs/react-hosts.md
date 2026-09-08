# React host API

`GraphExplorer` supports React 18 and 19 and requires a container with an explicit height. Import the combined package stylesheet once. The host owns its domain model, routing, calculations, and sharing policy; the viewer receives a validated `GraphDocument`. The exported interfaces are in [GraphExplorer.tsx](../src/react/GraphExplorer.tsx).

## Props

All props are optional except `document`.

| Prop | Type | Behavior |
|---|---|---|
| `document` | `GraphDocument` | Complete snapshot for the index, inspection, and native relationship traversal. Validate external input with `parseGraphDocument`. |
| `baseline` | `GraphDocument` | Previous snapshot for node/edge differences; does not imply revision ancestry. |
| `location` | `GraphLocation` | Controlled navigation. The host must accept `onLocationChange` and pass the resulting state back. |
| `initialLocation` | `GraphLocation` | Initial state for an uncontrolled viewer; subsequent changes to this prop do not replace navigation. |
| `onLocationChange` | `(location: GraphLocation, change: GraphLocationChange) => void` | Receives complete next state and explicit intent, including reselection of the same record. Existing one-argument callbacks remain compatible. The viewer does not update the host URL. |
| `inspectorRequestKey` | `string \| number` | Initial or changed supplied key opens Inspect without changing navigation, selection, focus, or camera. Useful for host-only nested detail with the same shared ID. |
| `canvasNodeFilter` | `(node: GraphNode, document: GraphDocument) => boolean` | Limits canvas records only. Excluded records remain searchable and inspectable. |
| `searchFiltersCanvas` | `boolean` | Defaults to `true`. With `false`, both query and kind filters affect the index only. Host canvas filtering, lineage scope, and collapse still apply. |
| `renderToolbar` | `(context: GraphHostContext) => ReactNode` | Adds controls alongside the shared fit/export controls. |
| `renderInspector` | `(context: GraphHostContext) => ReactNode` | Replaces the default inspector contents. The extended context remains compatible with callbacks accepting `GraphInspectorContext`. |
| `renderNodeDetails` | `(node: GraphNode, document: GraphDocument) => ReactNode` | Adds domain details to the default node inspector; not used when the inspector is replaced. |
| `renderNodeContent` | `(context: GraphNodeRenderContext) => ReactNode` | Replaces card contents inside the shared wrapper and source/target handles. |
| `getNodeSize` | `(node: GraphNode, document: GraphDocument) => { width: number; height: number }` | Supplies the whole card’s layout dimensions; defaults to 248 × 126. Values must be finite and positive. |
| `exportOptions` | `GraphExportOptions` | Enables explicit host-projected export; requires both `projectDocument` and `onExport`. |
| `assessments` | `ReceiptAssessment[]` | Separately supplied trusted verifier assessments. Malformed arrays fail closed. |
| `documentSha256` | `string` | Digest of the exact snapshot bytes, required for receipt assessment matching. |
| `revisions` | `{ id: string; label: string }[]` | Host-supplied revision choices. |
| `currentRevisionId` | `string` | Selected revision choice. |
| `onRevisionChange` | `(revisionId: string) => void` | Host loads the selected snapshot and updates props. The viewer does not fetch revisions. |

`GraphLocation` contains `selectedId`, `selectedType` (`'node'` or `'edge'`), `focusId`, `direction` (`'both'`, `'upstream'`, or `'downstream'`), `depth`, `showContainment`, `query`, `kinds`, and `collapsedIds`; each is optional. Selection is distinct from exploration focus and does not move the camera. The host may use `encodeLocation`/`decodeLocation` or retain its own URL format and Back/Forward handling.

## Contexts and navigation

```ts
interface GraphInspectorContext {
  document: GraphDocument;
  node?: GraphNode;
  edge?: GraphEdge;
  selectNode: (id: string) => void;
  selectEdge: (id: string) => void;
  focusNode: (id: string, direction?: GraphLocation['direction']) => void;
}

interface GraphHostContext extends GraphInspectorContext {
  location: GraphLocation;
  setLocation: (location: GraphLocation, change?: GraphLocationChange) => void;
  locateNode: (id: string) => boolean;
  visibleNodeIds: readonly string[];
  visibleEdgeIds: readonly string[];
}

interface GraphLocationChange {
  reason: 'select' | 'focus' | 'view';
}

interface GraphNodeRenderContext extends GraphInspectorContext {
  node: GraphNode;
  selected: boolean;
  change?: string;
  childCount: number;
  collapsed: boolean;
}
```

`setLocation` **replaces** navigation state; it does not merge a patch or accept a React state-updater function. Preserve fields explicitly: `setLocation({ ...location, query: '' })`. `focusNode(id, direction)` selects and focuses that node. Node and edge identities occupy separate namespaces, so use the matching selection function even when both records have the same ID.

`onLocationChange` always receives a second argument in version 0.3.0 and later:

- `select`: an explicit record/edge selection, including index, canvas, inspector, and context selection actions. Clicking an already selected record still emits this reason. Escape clears selection with the same reason.
- `focus`: `focusNode`, double-click exploration, or Whole graph. Focusing a node also sets its selection; clearing focus with Whole graph preserves selection.
- `view`: query, kind filter, depth, direction, containment, collapse, or reset-view changes. Context `setLocation` defaults to this reason; pass `{ reason: 'select' }` or `{ reason: 'focus' }` for those host actions. Pan, zoom, Fit all, Focus view, and Locate only affect the local camera and do not emit a location callback.

A host may select an exact nested field while highlighting its business ancestor. On `select`, resolve the host's selection to the explicit record even if `selectedId` is unchanged. On `view`, retain that precise host selection. Handle `focus` according to the host's exploration behavior. Metadata describes the user action, not a diff inferred from the two locations. External prop updates do not emit callbacks.

On mobile, explicit selection opens Inspect and focus opens Graph. After mounting, an external controlled change to `selectedId` or its normalized node/edge type opens Inspect; an external clear opens Graph. Reflection of the viewer's latest own navigation preserves the pane chosen by its intent, including delayed reflection of focus. View-only updates do not reopen Inspect, and the initial Graph pane is preserved for initial deep links. The host must reconcile asynchronous navigation and discard stale responses. For a host-only nested-field change that leaves both shared selection fields identical, increment `inspectorRequestKey` to reveal Inspect without emitting a location callback or resolving that detail to its business ancestor. A supplied initial key (including `0`) starts in Inspect; a changed supplied key requests Inspect again. An unchanged key does not reopen it after the user switches panes, and removing the key does not close it. A new explicit key takes precedence over simultaneous automatic selection/focus pane handling. This prop does not move keyboard focus. Omit the prop to retain existing initial Graph behavior.

The canvas filter is absolute: focusing a host-excluded record does not put it on the canvas. Focus may override search/kind matching, but cannot restore a collapsed descendant. Lineage is computed through the full document, including hidden intermediate records; only allowed records are drawn. Filtering does not synthesize shortcut relationships. The full index and visible canvas counts describe different scopes. These presentation controls do not redact source data.

## Large record indexes

Version 0.4.0 renders at most 100 result buttons at once, with Previous records and Next records controls. Search and type filters still cover the complete supplied document. A new result set starts on the first page; initial selections and changed selections within the same result set reveal their matching page. Index page changes stay local: they do not emit navigation callbacks, alter scope/relationships, or move the graph camera. This bounds the index DOM, not the graph document, lineage work, or canvas node count; use `canvasNodeFilter` for the host's business canvas. Pagination does not redact exports.

Version 0.4.6 compares kind-filter values as a set when retaining search results. A host may supply newly allocated arrays, reorder or repeat the same kinds, or interchange omitted and empty filters without resetting index paging or losing selected-row reveal. Kind matching remains case-sensitive, and the viewer preserves the original controlled location values. A changed filter value or document still creates a new result set; this does not require the host to stabilize array identity.

Host-requested pane changes commit before pending selected-row scrolling. If a mobile selection opens Inspect, the request remains pending until Browse returns or the viewport widens, then uses the current row sizes. Pane and size changes with no pending request preserve the user's scroll position.

## Focus framing and camera

Version 0.3.1 keeps the focused record centered instead of shrinking its entire neighborhood to fit. The preferred minimum automatic zoom is 0.85 (about 211 screen pixels for a default 248px card), capped at 1. If the focus card itself cannot fit, such as a large custom card on mobile, it is scaled down to fit. Normal canvases reserve 24px padding.

When the whole scene cannot fit at that readable scale, the camera frames the focus and up to six fitting incident neighbors, ordered by geometric distance and stable ID. This chooses a camera extent only: every projected node and native relationship remains in the canvas and is available by panning or through the index and inspector. No domain grouping, synthetic relationships, graph filtering, or layout changes are inferred from the framing subset. If the host excludes the focus from the canvas, the camera uses an overview of the allowed records.

**Fit all** explicitly frames the entire current canvas, including very large scenes that require zoom below 0.04. **Focus view** returns to readable framing without changing selection or scope. **Locate** centers the selected record. The controls do not emit location callbacks. Whole graph changes exploration scope and keeps its existing `focus` intent.

Version 0.4.3 exposes `GraphHostContext.locateNode(id)` to custom inspectors and toolbar controls. It frames a node already included in the current canvas and reveals Graph on mobile. Offscreen canvas nodes can be located. Selection, query, exploration focus, and the host URL remain unchanged; the method emits no location callback and does not infer a domain ancestor for the supplied ID.

The method returns `true` when it accepts the camera request. Framing waits for the canvas's current dimensions, so this is not a completion signal. A missing node, a record excluded by the current canvas filters or collapse state, or a callback whose scene differs from the current scene returns `false` without changing state. It cannot restore excluded records or locate an edge; use `visibleNodeIds` to disable unavailable actions. A pending request can frame only its matching logical scene; returning to that identical scene can match again. This method belongs to `GraphHostContext`, not `GraphNodeRenderContext`.

The camera is cached by graph geometry and exploration scope, separately from selection and index-only queries. Returning to a previous scope restores its camera; resizing preserves the world point under the viewport center and the zoom. Explicit camera controls and manual pan/zoom update that cached view. **Focus view** can reframe a focused scene for its new dimensions after a resize. A source-checkout regression fixture is at `examples/focus.html` with 18 synthetic records and custom card sizes.

Version 0.4.0 preserves the normal Dagre layout. If the pinned Dagre ordering heuristic throws its known rectangle-intersection error or produces nonfinite geometry, the viewer retries once on a fresh graph with that heuristic disabled. The retry retains every supplied node, parallel edge, cycle, and explicit dimension. Invalid geometry or a failed retry raises an error for the host error boundary; records are never silently omitted to force a layout.

## Custom cards

Return components as JSX, for example `renderNodeContent={context => <DomainCard {...context} />}`. A component can then use its own hooks; do not call `DomainCard(context)` or put hooks directly inside the render callback. The shared wrapper retains selection, keyboard access, and left/right handles. This prop is not a replacement for React Flow’s node-type/port API.

Keep dimensions stable across selection and provide room for all custom content, including the shared wrapper’s padding. `getNodeSize` receives no selection state. Update sizes when content changes, not when a card is clicked. Interactive buttons/inputs inside a card should use `className="nodrag nopan"`; stop propagation on their click and double-click handlers when those actions must not select or explore the containing card. Custom inspectors and toolbar controls remain responsible for their own accessible labels and keyboard behavior.

Prefer stable callbacks for expensive host rendering and projection work. Inline callbacks are supported; the layout cache uses graph identities, edges, and dimensions rather than callback identity.

## Explicit export

```ts
interface GraphExportRequest {
  document: GraphDocument;
  json: string;
}

interface GraphExportOptions {
  label?: string;
  projectDocument: (context: GraphHostContext) => GraphDocument | Promise<GraphDocument>;
  onExport: (request: GraphExportRequest) => void | Promise<void>;
}
```

The export button calls `projectDocument` with the full host context. The host must choose the shareable snapshot and maintain its referential integrity. The viewer validates the result, serializes it, and calls `onExport` with **only** `{ document, json }`. The returned document is a detached, validated copy. The request has no separate location, baseline, original-document reference, digest, or assessment properties. Fields deliberately included in the projected document remain present. `json` is the exact serialized projection; any new assessment must bind those bytes.

There is no implicit redaction, selection-derived subset, missing-reference repair, or fallback to the original snapshot. An invalid projection does not call `onExport`. Projection/export errors are shown in the viewer, and overlapping export attempts are blocked while one is in progress. The callback chooses whether to download JSON, save it, or hand it to the host’s offline-HTML export service. Canvas filtering alone is never a sharing policy.

The generic offline CLI bundles the standard viewer and supplied snapshot. Host callbacks and custom node, inspector, or toolbar components are not serialized into that HTML. A host that needs its identical custom interface offline must provide its own HTML renderer/bundle. Export projection defines which data may be shared; it does not transfer the host application’s UI.

## Minimal host without a routing framework

This React 18-compatible example uses synthetic records and explicitly exports that complete synthetic snapshot. Real applications should supply their own domain projection and sharing policy. `downloadJson` is the host’s file-delivery function.

```tsx
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { parseGraphDocument, type GraphLocation } from '@axiom-foundation/orrery';
import { GraphExplorer, type GraphHostContext, type GraphNodeRenderContext } from '@axiom-foundation/orrery/react';
import '@axiom-foundation/orrery/style.css';

const snapshot = parseGraphDocument({
  schemaVersion: 'graph-explorer/v1', id: 'synthetic', title: 'Synthetic records',
  nodes: [{ id: 'item', label: 'Example item', kind: 'record' }], edges: [],
});

function RecordCard({ node, focusNode }: GraphNodeRenderContext) {
  return <>
    <strong>{node.label}</strong>
    <button type="button" className="nodrag nopan"
      onClick={event => { event.stopPropagation(); focusNode(node.id); }}
      onDoubleClick={event => event.stopPropagation()}>Explore</button>
  </>;
}

function Inspector({ node, visibleNodeIds, locateNode }: GraphHostContext) {
  return <section className="ge-inspector-body">
    <h2>{node?.label ?? 'Select a record'}</h2>
    {node && <button type="button" disabled={!visibleNodeIds.includes(node.id)}
      onClick={() => { locateNode(node.id); }}>Locate in graph</button>}
  </section>;
}

function Host({ downloadJson }: { downloadJson: (json: string) => void }) {
  const [location, setLocation] = useState<GraphLocation>({});
  return <div style={{ height: '100dvh' }}>
    <GraphExplorer document={snapshot} location={location} onLocationChange={setLocation}
      searchFiltersCanvas={false}
      renderNodeContent={context => <RecordCard {...context} />}
      renderInspector={context => <Inspector {...context} />}
      getNodeSize={() => ({ width: 260, height: 140 })}
      renderToolbar={({ location, setLocation }) => <button type="button"
        onClick={() => setLocation({ ...location, query: '', kinds: [] })}>Clear search</button>}
      exportOptions={{
        projectDocument: ({ document }) => document,
        onExport: ({ json }) => downloadJson(json),
      }} />
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <Host downloadJson={json => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'synthetic-graph.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }} />,
);
```

The shared package contains no PlanGraph adapter or host-specific execution logic in this example. Consumer integrations remain with their owning applications.
