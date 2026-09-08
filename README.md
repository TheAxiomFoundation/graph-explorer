# Graph explorer

An embeddable graph viewer for application dependencies, evidence, and agent-produced records. Built with React Flow and Dagre. Apache-2.0.

The shared package owns navigation and presentation. Axiom, Microcosm, PlanGraph, and Thesis keep their own domain models, calculations, source authority, and adapters. Graphs can include cycles and multiple distinct relationships between the same records.

## Run locally

Requires Bun. From this repository:

```sh
bun install --frozen-lockfile
bun run dev
bun test
bun run typecheck
bun run build
bun run check:dist
python3 -m unittest discover -s tests -p '*_test.py'
```

The example app includes an Axiom graph projected by its existing software from a recorded compiled artifact, and a Thesis scientific-record graph created by replaying a committed source fixture through its native capture adapter. Provenance and limitations are in [examples/ADAPTERS.md](examples/ADAPTERS.md). No example calculates benefits with a substitute evaluator or represents fixture data as live evidence.

## Embed

```tsx
import { parseGraphDocument } from '@axiom-foundation/graph-explorer';
import { GraphExplorer } from '@axiom-foundation/graph-explorer/react';
import '@axiom-foundation/graph-explorer/style.css';

const document = parseGraphDocument(snapshot);

<div style={{ height: '100vh' }}>
  <GraphExplorer document={document} />
</div>
```

The package supports React 18 and 19. `bun run build` creates JavaScript, declarations, and combined viewer styles. Until a registry release, install the tarball created by `npm pack`.

`GraphExplorer` accepts a `baseline` for snapshot comparison and controlled `location`/`onLocationChange` for host routing. Selection and exploration focus are independent. Custom cards, sizes, toolbar controls, and inspectors use the [React host API](docs/react-hosts.md), including a full navigation context whose `setLocation` replaces state. Optional revision choices come from the host; revision strings alone do not imply ancestry.

`canvasNodeFilter` limits presentation while retaining the complete searchable index; `searchFiltersCanvas={false}` confines query and kind filters to that index. For an export button, `exportOptions` requires an explicit host projection and delivery callback. Delivery receives only the detached, validated document and its exact JSON, with no inherited navigation or verification state. Canvas filtering does not redact an export; see the [export contract](docs/react-hosts.md#explicit-export).

## Portable snapshots

The versioned contract is [src/core/types.ts](src/core/types.ts). A minimal graph:

```json
{
  "schemaVersion": "graph-explorer/v1",
  "id": "example",
  "title": "Example dependency",
  "nodes": [
    {"id": "input", "label": "Input", "kind": "observation"},
    {"id": "output", "label": "Output", "kind": "forecast"}
  ],
  "edges": [
    {"id": "uses-input", "source": "input", "target": "output", "kind": "provided", "category": "evidence"}
  ]
}
```

`kind` carries the domain meaning; `category` helps present it. `parentId` denotes containment, not causality. Keep stable domain IDs across snapshots; use revision-scoped identities for locations such as array indices. Sources, independent status badges, exact stored fields, and original scope metadata survive projection. Encode integers beyond JavaScript's safe range as `{ "integer_literal": "18446744073709551615" }` before JavaScript parses them.

Core exports include validation, adjacency indexes, directed upstream/downstream traversal, record/edge differences, safe links, and navigation serialization. Both-direction lineage is the union of ancestors and descendants; it does not collect unrelated sibling consumers merely because they share an input.

## Agent activity and Receipt

Activities distinguish authorship, execution, review, and import. Inputs explicitly distinguish **provided**, **cited**, and **consumed**; outputs refer to exact node/edge revisions. Artifacts and receipt references can describe both records and relationships.

Graph JSON cannot verify itself. Receipt references contain no executable configuration. Separately supplied verifier assessments must bind the exact graph bytes, receipt head, current subject revisions, and artifact digests. The real Receipt Python verifier remains responsible for cryptography and consumer-pinned trust. [Receipt integration](docs/receipt.md) documents the local bridge and its explicit artifact-custody scope. A valid receipt does not prove a claim correct, and graph-to-artifact association remains host-declared.

## Offline export

After building and packing this repository, install the tarball in a Node 20+ project. The installed CLI uses bundled assets and needs no Bun or source checkout:

```sh
npm install /path/to/axiom-foundation-graph-explorer-0.2.1.tgz
npx graph-explorer --input graph.json --output report.html
```

From the source checkout:

```sh
bun run build
bun run export --input graph.json --output output/report.html
# Optional comparison and explicitly supplied local verifier report:
bun run export --input graph.json --output output/report.html \
  --baseline before.json --assessment assessment.json
```

The single HTML file bundles the viewer, styles, and supplied graph. It needs no server, CDN, or network to render. Referenced source files and reports are links, not automatically included. Export is an explicit operation over the supplied snapshot: hiding fields in the UI does not redact them. Make a separate appropriately scoped snapshot before sharing; its changed bytes need their own assessment.

Node hosts can import `exportGraphHtml` from `@axiom-foundation/graph-explorer/export` with `{ input, output, baseline?, assessment? }`. Inputs are local paths supplied by the host. Export validates the snapshot and any separately supplied assessment, hashes the exact source bytes, and refuses to overwrite input files or their aliases.

Version 0.2.1 fixes two packaging failures in 0.1.0 and 0.2.0: the offline classic script retained a dependency's `import.meta.env`, and the React entry emitted a development-only JSX runtime that failed under `NODE_ENV=production`. Use 0.2.1 or later. After every build, `bun run check:dist` parses the actual exported classic script and renders the built React component in a fresh production Node process, including its host inspector and toolbar hooks. These checks complement browser interaction checks; importing a component alone does not test rendering.

## Scope of this release

The initial package provides search, type filters, directed neighborhood exploration, containment collapse, node/edge inspection, independent statuses, source links, activity and Receipt inspection, baseline comparison, keyboard navigation, and offline export. It does not impose a graph database, execute domain calculations, infer missing evidence, or reconstruct hidden model reasoning. Microcosm and PlanGraph integration is coordinated in their owning applications; Axiom and Thesis adapters are supplied as read-only projections.

Libraries: [React Flow](https://reactflow.dev/) (MIT), [Dagre](https://github.com/dagrejs/dagre) (MIT), and React (MIT). The provenance model is intentionally small and can be mapped to [W3C PROV](https://www.w3.org/TR/prov-overview/).
