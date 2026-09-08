# Axiom integration

Keep Pavel’s [axiom.org PR #239](https://github.com/TheAxiomFoundation/axiom.org/pull/239) moving independently. This note inspects head `eef365a18c1423e1823b5c8b6b77f300d526d2bc`; it proposes a later, owner-coordinated integration, not a replacement of that branch. No Axiom files were changed. The PR’s reported browser measurements were not independently rerun for this note.

## What can be reused

The shared package already supplies stable node/edge identity, typed relationships, directed lineage, search, independent status badges, exact fields and sources, baseline comparison, and portable offline reports. Controlled `location`/`onLocationChange` lets Axiom retain its router. `renderInspector` can host the existing domain inspector; `renderNodeDetails` can extend the default inspector. Both viewers use React Flow.

Pavel’s changes provide useful presentation work to preserve or extract with him:

| PR behavior | Current shared support | Integration requirement |
|---|---|---|
| Wider aisles respond to the stage aspect; leaf pairs reduce tall question stacks. | Fixed-spacing Dagre layout. v0.3.1 adds focus-centered readable camera framing, with the rest accessible by panning and explicit Fit all. | Camera framing alone does not reproduce native aspect-aware layout or leaf pairing. Add a layout extension receiving viewport dimensions and node measurements. Port the layout with its geometry checks; pairing eligibility and question meaning remain Axiom-owned. |
| Titled cards use a common width and content-driven height, including answers and action rows. | v0.2 supplies `renderNodeContent` and `getNodeSize`; the default remains 248 × 126 with shared left/right handles. | Port native card content and measured dimensions through these hooks. Add any remaining handle/edge-routing contracts before replacing Axiom’s canvas. |
| Legal-ID-based dedup keys preserve cards across graph rebuilds. | Stable IDs survive projection and selection. | Preserve existing rendered identities, including deterministic expression-node paths. Keep legal IDs available separately where a rendered node represents an expression. Never replace stable IDs with array counters. |
| Lens entry saves the map’s selected outputs and folds; the first lens level has a visible “← Map” return. | One controlled focus, direction/depth, fold IDs, and local viewport memory. | Axiom retains its lens trail and saved map state; expose any additional camera/navigation hooks needed to restore its complete prior view. |
| Surviving cards and camera move together; newly introduced cards fade in; stalled camera moves land explicitly. | Selection preserves the camera; explicit navigation currently fits without animation. | Add an optional transition/camera policy keyed to target layout and stable IDs, with reduced-motion and hidden-tab behavior. |

The relevant pinned source is [layout and leaf pairing](https://github.com/TheAxiomFoundation/axiom.org/blob/eef365a18c1423e1823b5c8b6b77f300d526d2bc/src/components/axiom/graph-viewer/InteractiveRuleGraph.tsx#L2724), [content-driven sizing](https://github.com/TheAxiomFoundation/axiom.org/blob/eef365a18c1423e1823b5c8b6b77f300d526d2bc/src/components/axiom/graph-viewer/InteractiveRuleGraph.tsx#L3105), [stable node identity](https://github.com/TheAxiomFoundation/axiom.org/blob/eef365a18c1423e1823b5c8b6b77f300d526d2bc/src/components/axiom/graph-viewer/InteractiveRuleGraph.tsx#L2609), and [layout transitions](https://github.com/TheAxiomFoundation/axiom.org/blob/eef365a18c1423e1823b5c8b6b77f300d526d2bc/src/components/axiom/graph-viewer/InteractiveRuleGraph.tsx#L943). The shared package uses `@dagrejs/dagre`; the PR uses `dagre`, so ported geometry needs validation against the shared dependency.

## Preserve Axiom behavior

Axiom continues to own composition, selected outputs, formula/trace dissection, input editing, scenario state, actual rule execution, calculated values, execution-path highlighting, citations, certification interpretation, and its run-results inspector. The shared package must not introduce another evaluator or infer execution from dependency edges. The [native host wiring](https://github.com/TheAxiomFoundation/axiom.org/blob/eef365a18c1423e1823b5c8b6b77f300d526d2bc/src/components/axiom/graph-viewer/viewer-app.tsx#L2944) illustrates the callbacks and execution state a complete integration must preserve.

The existing shared Axiom adapter projects `ProgramGraph` records and dependency relationships. Its recorded OASDI fixture is suitable for comparing read-only presentation. It does not yet project the native dissection’s expression nodes, interactive answer controls, or live run state. Matching that richer view requires a host-owned projection, use of the new content/sizing hooks, and the remaining layout/routing/camera extensions above.

Preserve `?compose=…&focus=…` as a lens into the full composed map, including the legal-ID fragment. A reload must retain a way back to the complete section; do not turn `focus` into a permanently trimmed snapshot. The PR explicitly [restores this compose/focus behavior](https://github.com/TheAxiomFoundation/axiom.org/blob/eef365a18c1423e1823b5c8b6b77f300d526d2bc/src/components/axiom/graph-viewer/viewer-app.tsx#L1653) and renders the [map return and trail](https://github.com/TheAxiomFoundation/axiom.org/blob/eef365a18c1423e1823b5c8b6b77f300d526d2bc/src/components/axiom/graph-viewer/viewer-app.tsx#L3282). Use controlled location to translate existing URLs rather than replacing them with the example app’s hash format.

The PR’s click-to-isolate policy considers fitted zoom and chain share; search and run landings follow different rules. This is an Axiom interaction decision, not a default for every graph. Its automatic folding also represents native trace dissection, while the shared viewer’s collapse currently represents containment. They need an explicit mapping, not a common name alone.

## Coordinated adoption

1. Pavel lands or revises PR #239 in his existing workflow. Agree on the later integration baseline and owner before changing the production consumer or standalone viewer copy.
2. Compare the same native snapshots in a separate shared-viewer route or development harness. Retain native controls and inspectors; begin with read-only dependencies.
3. Add the missing rendering/layout/camera contracts with Pavel, then port the presentation pieces as isolated changes. Keep domain execution and trace construction in Axiom.
4. Before any production switch, jointly check composed EITC at a wide viewport, long titles and answer rows, stable identities across fold/lens changes, search and run landings, focus-link reloads and Map return, Back/Forward, hidden tabs, reduced motion, and mobile canvas sizing. Verify no overlapping cards or routes through paired cards. Treat PR-reported mobile limitations as explicit integration coverage, not as already solved by sharing a component.

Adoption is optional until those checks preserve Axiom’s current behavior. The initial shared package can serve offline inspection and other consumers while Pavel’s native viewer remains in place.
