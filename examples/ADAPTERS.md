The homepage's [Mars signal example](../docs/mars-signal.md) uses recorded JPL
Horizons geometric Earth–Mars distances for two dates and a real native Axiom
evaluation of distance divided by the speed of light. It projects the actual
captured inputs, executable artifacts and calculation results into a small graph.
The result is a same-epoch distance estimate, not a live measurement or complete
communications latency. Source files are published by an explicit digest-checked
allowlist; unsigned execution and file hashes do not establish verified Receipt
custody. Existing domain adapters below remain separate.

The Axiom adapter accepts the viewer-facing `ProgramGraph` used by `axiom.org`
and `axiom-api`. IDs remain legal IDs; rule, input, relation, and relation-member
dependencies remain separate edge kinds. The adapter stores the complete source
node, including formula and citations. ProgramGraph does not contain immutable
node revision IDs; callers may supply those separately. Certificate IDs and
certification status remain declarations, without verification badges.

`axiom-oasdi.json` is an actual projection of the recorded compiled OASDI RuleSpec
artifact. `generate-axiom-fixture.ts` executed the existing Axiom API package
registry and graph projector, first checking the artifact against the repository's
release lock. Its source block records the API commit, artifact digest/release,
and projector digest. It is a historical graph, with no claim of current law,
fresh compilation, evaluated results, or verified certification. Recreate it:

```sh
bun examples/generate-axiom-fixture.ts /path/to/axiom-api
```

The Thesis adapter accepts `{id, kind, payload}` envelopes from the scientific
core API. Its pinned `LINK_SPECS` and artifact-field registry are exported from
the actual Python contracts, with repository/commit/path provenance. It preserves
full payloads and operational envelope fields separately. Each content-addressed
record is a node whose revision equals the declared record ID. It does not
recompute or verify those IDs. Unknown record kinds require a registry update.
Referenced records absent from the supplied snapshot appear as unavailable
nodes. A supplied evidence bundle is never labeled as observed consumption.
Publication proof records remain declarations; the adapter does not create
Receipt assessments or infer authorship from an execution model.

`thesis-source-replay.json` was produced by executing Thesis's native `capture`
adapter on its committed StatCan test fixture. It contains native record IDs,
canonical payloads, and the native `record_links()` results used for adapter
parity tests. This is a local fixture replay. Historical accuracy of the input
fixture and its original retrieval have not been verified; no live retrieval,
forecast, publication, timestamp proof, or custody verification occurred.
Artifact hashes are preserved, but this portable example does not include the
artifact store. Recreate it using the Thesis environment:

```sh
/path/to/thesis/.venv/bin/python examples/generate-thesis-fixture.py /path/to/thesis
```

Both adapters are pure data projections. They execute no graph-provided code,
perform no network access, and fetch no referenced artifact. JSON shape checks
are not domain validation; the corresponding native engine remains authoritative.
