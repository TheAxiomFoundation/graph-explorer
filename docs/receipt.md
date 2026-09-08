# Receipt integration

The viewer treats receipt references as declarations. A separately configured
local verifier can establish custody of referenced artifact bytes. The link
between those artifacts and graph subjects is declared by the host; Receipt
does not verify that the graph accurately projects the artifacts, that any
declared gate actually passed, or that a rule is correct.

`scripts/receipt_bridge.py` uses the real Receipt package. It launches a fixed
worker in the operator's chosen Python environment and calls
`receipt.verify.load_spec`, `run_verification`, and `result_to_dict`. It adds
`checkedFiles` from the actual `VerifyResult.corpus.content` and `.attested`
objects. There is no new cryptographic implementation.

The stock `receipt verify --json` report in Receipt 0.5.1 contains corpus counts
but does not enumerate checked file digests. Its PASS alone cannot bind a graph
subject. A report lacking that evidence remains `unchecked`.

## Configure a local assessment

Choose a trusted installed Receipt environment, review the consumer's local
verification spec, and pin its digest. The spec is Python code and executes
with the operator's permissions. Receipt's producer keys and authority pins
come from that separately selected spec. Neither graph URLs nor graph fields
can select an executable, import, spec, root, or trust anchor.

Create a separate binding file for the exact graph bytes. This is an operator
configuration, not a producer signature. Never populate it automatically from
an untrusted graph and treat the result as independent evidence. Review the
association between each subject revision and the actual artifact path.

```json
{
  "schemaVersion": "graph-explorer/receipt-binding/v1",
  "documentSha256": "<SHA-256 of exact graph.json bytes>",
  "receiptId": "release-receipt",
  "receiptSha256": "<checked release manifest SHA-256>",
  "specSha256": "<reviewed verification/spec.py SHA-256>",
  "subjects": [{"type": "node", "id": "rule-1", "revision": "immutable-revision"}],
  "artifacts": [{
    "id": "rule-source",
    "path": "rules/example.yaml",
    "sha256": "<checked artifact SHA-256>",
    "subjects": [{"type": "node", "id": "rule-1", "revision": "immutable-revision"}]
  }]
}
```

Replace the placeholders with lowercase 64-character digests. Graph receipt
`release-receipt` must declare exactly those subjects, the same receipt digest,
and exactly the bound artifact IDs. Each graph artifact must declare the same
digest. The graph objects must exist with the same revisions. Every subject
must have at least one explicit artifact association. Paths come solely from
the local binding and must appear with matching digests in Receipt's actual
checked files.

```sh
python3 scripts/receipt_bridge.py \
  --graph /work/graph.json \
  --receipt-id release-receipt \
  --bindings /work/reviewed-bindings.json \
  --receipt-python /trusted/receipt-env/bin/python \
  --spec /trusted/corpus/verification/spec.py \
  --root /trusted/corpus \
  --output /work/receipt-assessment.json
```

The report must be written outside the verified corpus. `--base-ref` can add
Receipt's existing history check against a previously recorded git reference.
That check does not establish that a release is the newest or only history.

The output contains `assessments`, the complete Receipt `report`, and the
operator `binding` for successful assessments. It records the verifier version,
spec digest, release head, exact graph digest, subjects, and artifact digests.
Use this sidecar only through a host-controlled assessment channel. Do not
accept assessments embedded in graph JSON, imported with an arbitrary graph,
or fetched automatically from its receipt URLs. The JSON sidecar itself is
not signed; its trust depends on the local invocation and delivery channel.

An assessment is:

- `verified` only when real Receipt verification and every required binding
  check succeeds. Its scope is **artifact custody**, with host-declared graph
  associations.
- `failed` for verification failure, malformed output, or a conflicting digest,
  receipt identity, subject revision, or artifact association.
- `unavailable` when the explicitly selected environment or inputs cannot be
  used, including timeout or a missing Receipt package.
- `unchecked` when a separate subject/artifact binding was not supplied or the
  verifier cannot provide per-file evidence.

Only `verified` exits with code 0. Other assessment states exit with code 1;
invalid CLI usage or an unreadable graph exits with code 2. The default verifier
timeout is 120 seconds and can be configured with `--timeout`.

## Verification performed

Run the bridge boundary tests with:

```sh
python3 -m unittest discover -s tests -p 'receipt_bridge_test.py' -v
```

Fourteen tests cover command refusal, untrusted graph verdicts, exact snapshot
binding, subject revisions, artifact associations, receipt and spec pins,
malformed/failing reports, unavailable runtimes, and timeout. They simulate
subprocess output to exercise those failure paths; they do not substitute for
Receipt's cryptographic verification tests.

A real smoke check on 2026-09-08 used the local Receipt 0.5.1 repository's
`tests/corpus_fixture.py:build_corpus`. That fixture generates an actual
Ed25519 producer signature and two actual RFC 3161 tokens from local test
authorities. No production keys or external services were used. The stock
Receipt CLI returned PASS, the bridge returned `verified` for the mapped tax
rate fixture, and its report enumerated four checked files. Replacing the
mapped source file then caused Receipt FAIL and bridge `failed`.

This validates the integration against actual Receipt software and genuine
test cryptography. It is not production provenance for Axiom, Microcosm, or
PlanGraph.
