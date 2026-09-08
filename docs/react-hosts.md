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
| `onLocationChange` | `(location: GraphLocation) => void` | Receives the complete next navigation state. The viewer does not update the host URL. |
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
  setLocation: (location: GraphLocation) => void;
  visibleNodeIds: readonly string[];
  visibleEdgeIds: readonly string[];
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

The canvas filter is absolute: focusing a host-excluded record does not put it on the canvas. Focus may override search/kind matching, but cannot restore a collapsed descendant. Lineage is computed through the full document, including hidden intermediate records; only allowed records are drawn. Filtering does not synthesize shortcut relationships. The full index and visible canvas counts describe different scopes. These presentation controls do not redact source data.

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
import { parseGraphDocument, type GraphLocation } from '@axiom-foundation/graph-explorer';
import { GraphExplorer, type GraphNodeRenderContext } from '@axiom-foundation/graph-explorer/react';
import '@axiom-foundation/graph-explorer/style.css';

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

function Host({ downloadJson }: { downloadJson: (json: string) => void }) {
  const [location, setLocation] = useState<GraphLocation>({});
  return <div style={{ height: '100dvh' }}>
    <GraphExplorer document={snapshot} location={location} onLocationChange={setLocation}
      searchFiltersCanvas={false}
      renderNodeContent={context => <RecordCard {...context} />}
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
