# OSS landscape and the shared explorer

Reviewed 2026-09-08 against the official sources linked below.

Borrow graph rendering and layout. Build and test the shared inspection workflow
across Axiom, Microcosm, PlanGraph, and Thesis. **A reusable component has a
concrete internal use case; an underserved external market remains a hypothesis.**
Existing tools already cover visualization, exploration, and provenance models.

## What to borrow

| Project | License / form | Workflow and relevance |
| --- | --- | --- |
| [React Flow](https://reactflow.dev/) + [Dagre](https://github.com/dagrejs/dagre) | MIT / MIT; component and layout library | The current implementation uses these for React record cards, selection, navigation, and directed layout. This suits inspecting rules, evidence, and task records. React Flow supplies interaction; Dagre supplies positions. |
| [Cytoscape.js](https://js.cytoscape.org/) | MIT, including first-party extensions | Interactive graph analysis, compound nodes, algorithms, and many layouts. A strong alternative when network analysis dominates the workflow. |
| [Sigma.js](https://www.sigmajs.org/) + [Graphology](https://github.com/graphology/graphology) | MIT / MIT | WebGL rendering plus a separate graph model and algorithm ecosystem. Worth evaluating for dense network overviews; no performance advantage for our actual data is claimed without a benchmark. |
| [Graphviz](https://graphviz.org/about/) | [EPL-2.0](https://graphviz.org/license/); layout tools and libraries | Text descriptions become diagrams, including SVG and document outputs. Useful for publication figures, batch exports, and layout comparisons. It also has interactive interfaces; it should not be described as exclusively static. |
| [Gephi Lite](https://gephi.org/lite/) | GPL-3.0; complete web application | Browser-local graph import, ranking, layout, styling, and exploration. Supports iframe embedding and a TypeScript driver. An existing general explorer, and a useful workflow reference. |
| [AWS Graph Explorer](https://github.com/aws/graph-explorer) | Apache-2.0; complete React application | Graph, table, and schema exploration, search, and neighborhood expansion. Supports Gremlin and RDF/SPARQL endpoints, plus openCypher through Neptune. Compare its database exploration workflow before expanding our own shell. |
| [cosmos.gl](https://github.com/cosmosgl/graph) / [Cosmograph](https://next.cosmograph.app/pricing/) | MIT engine / separately licensed product | The engine provides GPU force layout and rendering. Cosmograph's finished exploration product has commercial licensing; its free plan is for noncommercial use. The engine's license does not make every Cosmograph product or integration permissive OSS. |

The current choice is an implementation decision, not a universal ranking.
[React Flow's layout guide](https://reactflow.dev/learn/layouting/layouting)
documents Dagre and alternatives such as ELK. Revisit layout when real adapter
data demonstrates a routing or grouping problem. A new rendering engine is not
required to test the shared product.

## Existing provenance models

[W3C PROV](https://www.w3.org/TR/prov-dm/) already defines domain-independent
entities, activities, agents, derivation, and responsibility. It is a family of
specifications, rather than an installable viewer; its documents carry W3C
document-use terms. Its vocabulary is a useful reference for keeping authorship,
execution, and provenance distinct. This repository does not currently claim
PROV conformance or provide a PROV importer.

[OpenLineage](https://github.com/OpenLineage/OpenLineage), Apache-2.0, supplies a
model and integrations for collecting job, run, and dataset lineage. Its
[object model](https://openlineage.io/docs/spec/object-model/) explicitly
distinguishes runtime events from static job/dataset metadata. That distinction
is useful for Microcosm and other pipelines: a declared dependency and an
observed execution should remain separate. OpenLineage integration is a possible
adapter, not functionality already implemented here.

## The product hypothesis

The hypothesis is that applications can share a useful **domain-neutral
provenance and Receipt inspector**: typed relationships, immutable subject
revisions, sources, separate activities, graph comparison, focused lineage, and
portable offline reports. Domain adapters retain the meaning of native records;
the shared viewer makes them navigable. The existing [Receipt bridge](receipt.md)
adds explicit, separately configured verification of artifact custody.

This combination may reduce repeated work and be useful outside these projects.
The survey does not establish that competitors lack these features or that
users will adopt another product. Validate that hypothesis through actual
consumer integrations and external users completing tasks such as tracing a
result to its inputs or checking what changed between revisions.

Thesis fits because scientific records also have typed dependencies: source
exchanges, observations, evidence bundles, forecast runs, and publication
records. Its [adapter](https://github.com/TheAxiomFoundation/orrery/blob/v0.5.0-preview.2/src/adapters/thesis.ts) projects the native relationship
registry and preserves declared identities and artifact references. A source
capture or evidence bundle does **not** prove an agent actually consumed it;
the adapter labels supplied evidence accordingly. The committed
[Thesis example](../examples/ADAPTERS.md) is a native fixture replay, not proof
of live retrieval, forecast execution, or production custody. Receipt validity
likewise does not establish scientific or policy correctness.
