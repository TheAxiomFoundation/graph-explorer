# Trace a value

Orrery remains a general graph viewer. A data pipeline, calculation or forecast
can optionally supply named values, their stages, and explicit dependency roles.
Orrery then presents a focused upstream trace without guessing which operation
inputs contributed to a particular output.

The source system owns those declarations. An operation reading a field and
producing several outputs does not establish that the field determines every
output. Missing per-output mappings remain unknown. Source declarations do not
establish execution, verification, or correctness.

## Optional annotations

Add `lineage` to a normal `graph-explorer/v1` document. All IDs below reference
existing native graph nodes or edges; the annotation does not duplicate them.

```json
{
  "schemaVersion": "orrery-lineage/v1",
  "variables": [{
    "id": "amount",
    "label": "Amount",
    "stages": [
      { "id": "normalized", "label": "Normalized", "nodeId": "amount-normalized" },
      { "id": "selected", "label": "Selected rows", "nodeId": "amount-final" }
    ]
  }],
  "relations": [
    { "edgeId": "transfer-input", "role": "value" },
    { "edgeId": "selection-transfer", "role": "control" },
    { "edgeId": "operation-context", "role": "context" }
  ],
  "boundaries": [{
    "nodeId": "source-value",
    "kind": "source",
    "description": "The declared source at which this mapping stops."
  }]
}
```

This fragment illustrates the shape; a complete invented graph is in
[`examples/lineage-fixture.json`](../examples/lineage-fixture.json).

Variable IDs must be unique and each variable must have at least one stage.
Stage IDs and stage node IDs must be unique within that variable; different
variables may refer to the same node. Optional variable `description` supplies
searchable context. Stage order is authored display order. The default is the
first variable's last stage, without claiming that it is chronologically newest.

Each edge can have one annotated role. The original `kind`, direction, identity,
and payload retain their exact domain meaning. Dependencies run from input to
output, and tracing follows them upstream:

| Role | Trace behavior |
| --- | --- |
| `value` | Follow recursively by default. |
| `control` | Omit by default. “Include controls” recursively includes these inputs and their value/control dependencies. Use exact edge kinds to distinguish row selection, masks, weights, or other controls. |
| `context` | “Include context” adds one incident hop from the reached value/control nodes. It does not traverse through the added context. |

Unannotated edges stay in the full graph. They never become value dependencies
because of their kind, category, label, or position. Parallel edges remain distinct.

A node can have one boundary: `source` or `unknown`, with a required description.
Both stop upstream traversal. An input leaf with no boundary is reported as
unknown. Cyclic inputs are reported as unresolved groups, including a cycle that
also has source inputs. Context-only nodes do not supply source or cycle evidence.
No trace result asserts completeness.

## Navigation and embedding

Annotated graphs offer a Variables index, stage selection, and optional controls
and context. The Records index and normal graph exploration remain available.
Selecting a record inspects it without changing the trace root or camera. “Whole
graph” and explicit neighbor exploration leave trace mode. Fit and Locate remain
presentation actions.

The React component does not force a default over host-controlled state. Hosts
can opt into the same default used by offline reports and local JSON imports:

```tsx
import { getDefaultLineageLocation } from '@axiom-foundation/orrery';
import { Orrery } from '@axiom-foundation/orrery/react';

<Orrery document={graph} initialLocation={getDefaultLineageLocation(graph)} />
```

`GraphLocation` adds `traceId` (the root node), `traceVariableId` (the named value),
`traceControls`, and `traceContext`. `selectedId` and `selectedType` remain
independent. `encodeLocation` and `decodeLocation` preserve these fields for
copied links and Back/Forward. Variable search is local presentation state.

While tracing, record query/type filters, depth and containment/collapse settings
do not trim the declared dependency path. `canvasNodeFilter` still applies.
Orrery reports trace records excluded by the host and never invents shortcut
edges around them. Excluded records remain inspectable in the full index.

Core consumers can call:

```ts
const trace = traceLineage(graph, rootNodeId, {
  includeControls: false,
  includeContext: false,
});
```

The result includes `nodeIds`, `edgeIds`, `boundaries` with a `declared` flag,
`cycles`, `excludedControlEdgeIds`, `contextEdgeIds`, and `validRoot`. Invalid or
unavailable roots return `validRoot: false`; they are not interpreted as sources.

## Exports and compatibility

Trace and canvas scope are presentation, not redaction. A standard JSON or HTML
export retains the full supplied snapshot and its annotations. A host that
intentionally projects an export must also project the annotations. Dangling
stage, boundary or edge references fail validation. No verification assessment
is inherited merely because a source or transformation appears in a trace.

Graphs without annotations keep their existing behavior. Older Orrery parsers
strip the unknown top-level `lineage` property; they cannot retain this feature
through a parse/export round trip. Use a package that explicitly supports the
lineage extension when transporting these annotations.
