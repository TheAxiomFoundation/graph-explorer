# Orrery by Axiom

**See the system. Trace the work.**

An embeddable graph viewer for application dependencies, evidence, and agent-produced records. Built with React Flow and Dagre. MIT.

[Try the public preview](https://theaxiomfoundation.github.io/orrery/) · [Download a release](https://github.com/TheAxiomFoundation/orrery/releases) · [Migrate from graph-explorer](docs/migration.md)

The shared package owns navigation and presentation. Axiom, Microcosm, PlanGraph, and Thesis keep their own domain models, calculations, source authority, and adapters. Graphs can include cycles and multiple distinct relationships between the same records.

The preview opens local graph JSON in your browser without uploading it. Explore
the supplied examples, follow their sources, and save an interactive offline
HTML report. The homepage starts with a simple question: how long would a message
take to reach Mars? Two recorded dates connect real JPL planetary distances to
a calculation executed by Axiom. Follow the inputs, compare the results, and
inspect the captured sources and native calculation trace. See the
[Mars example](docs/mars-signal.md) for its approximation and reproduction steps.

The Thesis walkthrough remains available as a deeper example, tracing a real
published exploratory forecast through evidence, generation, source review and
revision. Outstanding scientific review findings remain visible; artifact
integrity and Receipt verification are separate from correctness.

## Run locally

Requires Bun and Node 20+ with npm. CI uses Node 24. From this repository:

```sh
bun install --frozen-lockfile
bun run dev
bun test
bun run typecheck
bun run build
bun run check:dist
python3 -m unittest discover -s tests -p '*_test.py'
bun run build:site
```

Serve `site-dist/` to preview the website, for example with
`python3 -m http.server 4780 --directory site-dist`. The development server above
opens the smaller embedding examples. The public site deploys only `site-dist/`,
after the main branch passes CI.

The example app includes an Axiom graph projected by its existing software from a recorded compiled artifact, and a Thesis scientific-record graph created by replaying a committed source fixture through its native capture adapter. Provenance and limitations are in [examples/ADAPTERS.md](examples/ADAPTERS.md). No example calculates benefits with a substitute evaluator or represents fixture data as live evidence.

### Packed browser gate

After building, run the automated browser gate:

```sh
bunx playwright install webkit
bun run check:browser
```

The gate requires only [Playwright's WebKit browser](https://playwright.dev/docs/browsers#install-browsers), using the package version pinned in this repository. On Linux, `bunx playwright install --with-deps webkit` also installs its system dependencies; CI uses this command. The gate packs the built package, installs that tarball into a fresh React 18.3.1 consumer outside the checkout with lifecycle scripts disabled, and uses the installed CLI to export a synthetic graph and baseline. It serves the resulting HTML on localhost and checks visible nodes and edges through 20 repeated loads and mounting resizes, selection, unchecked Receipt declarations, revision comparison, and mobile navigation. Browser errors and external asset requests fail the check. It also renders the installed React entry in a fresh production Node process.

To diagnose an existing candidate or reproduce a regression, supply its immutable tarball:

```sh
bun run check:browser --tarball /absolute/path/to/package.tgz
```

The same installed consumer also builds synthetic React 18 hosts through the public exports. WebKit checks custom inspector and toolbar Locate actions, unchanged navigation and host detail, hidden-pane resizing, and rejected excluded or stale-scene targets. It also checks selected-record paging with equivalent new kind-filter arrays, search relevance across 242 matches, complete result paging, and camera retention during index-only search. `GraphHostContext.locateNode(id)` is available from 0.4.3; see [host camera controls](docs/react-hosts.md#focus-framing-and-camera).

Runs write `report.json`, `host-report.json`, and `search-report.json` under a unique `output/playwright/packed-*` directory, with browser screenshots when available. The reports record artifact and generated asset hashes so results identify the tested bytes. CI runs this gate after `check:dist` and retains those reports and screenshots for 14 days on success or failure. Its artifact upload includes only those evidence files; the temporary consumer and tarballs remain local to the run.

## Embed

```tsx
import { parseGraphDocument } from '@axiom-foundation/orrery';
import { Orrery } from '@axiom-foundation/orrery/react';
import '@axiom-foundation/orrery/style.css';

const document = parseGraphDocument(snapshot);

<div style={{ height: '100vh' }}>
  <Orrery document={document} />
</div>
```

The package supports React 18 and 19. `Orrery` is an alias for the existing `GraphExplorer` component. `bun run build` creates JavaScript, declarations, and combined viewer styles. The preview is distributed as an installable GitHub release tarball; see the [exact install command](docs/migration.md). A registry publication is separate.

`GraphExplorer` accepts a `baseline` for snapshot comparison and controlled `location`/`onLocationChange` for host routing. Selection and exploration focus are independent. Custom cards, sizes, toolbar controls, and inspectors use the [React host API](docs/react-hosts.md), including a full navigation context whose `setLocation` replaces state. Optional revision choices come from the host; revision strings alone do not imply ancestry.

Location callbacks include `{ reason: 'select' | 'focus' | 'view' }`, so a host can distinguish clicking the highlighted business record from view changes that preserve a more precise nested-field selection. Existing one-argument callbacks remain compatible. External controlled selection changes reveal the mobile inspector, while focus actions keep the graph visible.

For host-only nested selections with an unchanged shared ID, `inspectorRequestKey` opens the mobile inspector without changing navigation. Large record indexes render 100 results per page while searching the complete document. Search puts exact label or ID matches first, other label/ID matches next, then matches that need descriptive fields. All matches remain available; ties and empty searches retain document order.

Focused views center the focus at a readable scale and frame nearby connected records that fit. The remaining records and relationships stay available by panning. **Fit all** shows the complete canvas; **Focus view** returns to the readable focus. Inspection and index-only search preserve the camera, and resizing preserves its world center and zoom.

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
npm install /path/to/axiom-foundation-orrery-0.5.0-preview.2.tgz
npx orrery --input graph.json --output report.html
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

Node hosts can import `exportGraphHtml` from `@axiom-foundation/orrery/export` with `{ input, output, baseline?, assessment? }`. Inputs are local paths supplied by the host. Export validates the snapshot and any separately supplied assessment, hashes the exact source bytes, and refuses to overwrite input files or their aliases.

Version 0.2.1 fixed two packaging failures in 0.1.0 and 0.2.0: the offline classic script retained a dependency's `import.meta.env`, and the React entry emitted a development-only JSX runtime that failed under `NODE_ENV=production`. Version 0.4.2 also preserves React Flow's measured node sizes across rerenders, fixing an intermittent hidden canvas during initialization and resizing. Use 0.4.2 or later. After every build, `bun run check:dist` parses the actual exported classic script and renders the built React component in a fresh production Node process, including its host inspector and toolbar hooks. The packed browser gate then checks the installed artifact in WebKit; importing a component alone does not test rendering.

## Scope of this release

The initial package provides search, type filters, directed neighborhood exploration, containment collapse, node/edge inspection, independent statuses, source links, activity and Receipt inspection, baseline comparison, keyboard navigation, and offline export. It does not impose a graph database, execute domain calculations, infer missing evidence, or reconstruct hidden model reasoning. Microcosm and PlanGraph integration is coordinated in their owning applications; Axiom and Thesis adapters are supplied as read-only projections.

Libraries: [React Flow](https://reactflow.dev/) (MIT), [Dagre](https://github.com/dagrejs/dagre) (MIT), and React (MIT). The provenance model is intentionally small and can be mapped to [W3C PROV](https://www.w3.org/TR/prov-overview/).
