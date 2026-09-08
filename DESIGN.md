# Graph explorer v0.1

Visual thesis: a quiet paper-toned workspace where the graph is the main surface, with a compact searchable index and a precise inspector.
Content plan: working graph first; navigation at left; record, evidence, and activity detail at right; no marketing hero.
Interaction thesis: preserve the viewport on selection; use restrained camera focus for explicit navigation; progressively disclose neighbors and record details. Respect reduced motion.

The first release provides portable JSON, validation, graph traversal and diffs, React Flow presentation, receipt references and separately supplied verification assessments, and single-file offline HTML export. Domain adapters translate real records, never synthesize calculations or evidence. Receipt uses the existing Python verifier rather than new browser cryptography.

The common model supports typed directed multigraphs (including cycles), containment separately from semantic relationships, stable identity and revisions, sources, independent status badges, agent activities, and artifact/receipt references on nodes and edges. Activities distinguish provided, cited, and consumed inputs. Full graph and focused neighborhood views share selection and URL state.

Integration ownership: the active PlanGraph and Microcosm agents own domain consumers and have been asked to supply adapters. This repository owns the shared core and viewer. Axiom and Thesis source adapters are read-only projections.
