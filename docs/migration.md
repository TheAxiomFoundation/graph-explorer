# Moving to Orrery

Orrery by Axiom is the new name for the shared graph explorer. Axiom, Microcosm,
PlanGraph and Thesis retain their names and own their domain models.

The repository is now [TheAxiomFoundation/orrery](https://github.com/TheAxiomFoundation/orrery).
The package name is `@axiom-foundation/orrery`; the primary command is `orrery`.
Install the identified archive from a [GitHub release](https://github.com/TheAxiomFoundation/orrery/releases).
Do not assume a registry version exists before it is published.

```sh
npm install https://github.com/TheAxiomFoundation/orrery/releases/download/v0.5.0-preview.1/axiom-foundation-orrery-0.5.0-preview.1.tgz
npx orrery --input graph.json --output report.html
```

## React

```tsx
import { Orrery } from '@axiom-foundation/orrery/react';
import '@axiom-foundation/orrery/style.css';

<Orrery document={snapshot} />
```

`Orrery` and `OrreryProps` are aliases for `GraphExplorer` and `GraphExplorerProps`.
Existing named exports, host callbacks, canvas controls and export projection
contracts remain supported. Changing package imports is sufficient; no adapter
or data migration is required.

Hosts that need to retain the old import path can point that dependency key at
the new archive explicitly:

```json
{
  "dependencies": {
    "@axiom-foundation/graph-explorer": "https://github.com/TheAxiomFoundation/orrery/releases/download/v0.5.0-preview.1/axiom-foundation-orrery-0.5.0-preview.1.tgz"
  }
}
```

After a registry publication, an npm alias is another option:
`"@axiom-foundation/graph-explorer": "npm:@axiom-foundation/orrery@0.5.0-preview.1"`.
The package also retains `graph-explorer` as a CLI alias. An old package name is
not automatically redirected by npm; choose the dependency alias explicitly.

## Persisted contracts

Keep `graph-explorer/v1`, `graph-explorer/receipt-binding/v1` and
`graph-explorer/receipt-assessment/v1` unchanged. Existing snapshots, Receipt
bindings and offline reports remain valid. The embedded `graph-explorer-data`
element remains supported. Historical archives and their digests are immutable.

The preview incorporates the MIT license change proposed in repository PR #2.
Earlier archives retain their original license; bundled dependency notices are
preserved independently.
