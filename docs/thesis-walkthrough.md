# A recorded forecast, its sources, and its unresolved review

The Orrery walkthrough uses two **real, already-recorded Gemini attempts** from
Thesis's public conditional forecast example: the 2030 national NAEP eighth-grade
mathematics score under enactment and non-enactment of the American Teacher Act.
It is an exploratory forecast, not a calibrated causal estimate. Source and
arithmetic findings remain unresolved in both attempts. No automatic condition
or outcome resolver, prospective rank, training reward, or Receipt is supplied.

The example makes that disagreement visible. Follow a public source to a history
value or source statement, then to the frozen evidence packet, recorded execution,
shared reference forecast and conditional outputs. Inspect the source review and
the original-to-revised association without losing the original distributions.
Selecting a record never runs a model or retrieves a source.

## What actually happened

The original Gemini attempt began on September 7, 2026 at 17:25:42 UTC; the revised
attempt began at 17:35:28 UTC. The model request and provider-reported model both
name `gemini-3.1-pro-preview`. Thesis matched the operator-recorded provider
envelope to the archived response. Its separate `observed_model` field is null:
this is not independent proof of the provider's origin.

| Recorded attempt | Shared reference median | Enacted median (central 80%) | Not enacted median (central 80%) |
| --- | ---: | --- | --- |
| Original `f8780f67…` | 276.5 | 276.7 (271.7–281.7) | 276.4 (271.4–281.4) |
| Revised `30299a64…` | 278.0 | 278.1 (274.1–282.1) | 278.0 (274.0–282.0) |

These are the native quantiles of the original 201-point CDFs. Orrery does not
generate a new forecast, fit a distribution, or change the numbers. Each attempt
generated its reference and both arms in one call. The reference is a shared
modeling starting point, not an unconditional mixture. The difference between
arm medians is not an identified causal effect or an effect uncertainty interval.

The original review has four findings. The revised review has three distinct findings:
unsupported nonpublic-student share, unsupported national extrapolation, and an
arithmetic bridge that does not establish the final +0.1-point adjustment. This
is a different set of findings, not evidence that one original issue was resolved. Both
reviews have `review_basis=operator_assessment` and `outcome=issues_remaining`.
The software review of Thesis does not endorse these forecast claims.

The revision association was recorded retrospectively at 18:35:43 UTC. It links
the original attempt, its review, exact feedback bytes, and revised attempt on
the same contract and evidence. That record time does **not** prove that the
review existed before the revised execution. The feedback remains linked as
provided input, not as proof that every statement or source was consumed.

## Exact public origin

All input bytes come from the committed public allowlist at
[`ThesisInstitute/thesis`, commit `1bf1bf2c98f8d313df4f03be175c4e6f1a495c27`](https://github.com/ThesisInstitute/thesis/tree/1bf1bf2c98f8d313df4f03be175c4e6f1a495c27/site/lab-publication).
This is the publication added in Thesis PR #236. The publication timestamp is
September 7, 2026 at 18:45:50 UTC, distinct from model execution and source capture.

The committed input used here is
[`examples/thesis-walkthrough-publication.json`](https://github.com/TheAxiomFoundation/orrery/blob/v0.5.0-preview.2/examples/thesis-walkthrough-publication.json).
It retains the two complete native public detail projections and a reproducible
validation inventory. Original source bodies, prompts, commands, code captures,
raw responses, provider envelopes, reports and feedback are linked by their exact
SHA-256 to the upstream commit. PDFs and other large artifacts are not duplicated
in Orrery; offline exports retain references and do not fetch them automatically.

Important identities:

- Contract: `3d8929b6610cc465a8d5c7b59c7746268ce8a4b275d9b523149fd9015e57a913`.
- Shared evidence: `d0b50d078aa3671673f6e55390168d975a6118b68ab726401d4578a5f73b34c4`.
  This is a derived native identity, **not** an artifact filename.
- Original attempt: `f8780f671529f6141a5f69c6fd6c8f6b8d58753b3e77b9da59ccb5c365843141`.
- Revised attempt: `30299a64369382fea583f60b0ccf5ca32a5065c744acf631e2404ac9e74e79e6`.
  Its dispatch artifact has a different ID, `4f4a321a…`; they are not conflated.
- Revision association: `4dc7689741ece4bc6ffd553145b55e5ff6d3afd44cf53e19b4f59d121ffed7d3`.

Top-level native identities are preserved. Nested source, history, reference and
arm IDs namespace the native parent identity plus the field or source identity.
Native payloads retain the exact local source and arm IDs. Semantic edges name
their meaning: packet provision, source citation, reported output, reference
adjustment, review and retrospective revision association remain separate.

Response citation edges extract exact known source IDs from square brackets in
`response.reference_reasoning` and `response.arms[].reasoning`, including
comma-separated IDs such as `[naep-calendar, naep-framework]`. They do not infer
citations from prose or mistake numerical intervals for source IDs. The original
attempt has no recognized bracketed source IDs; this does **not** establish that
it cited or used no sources. Its complete reasoning and supplied evidence remain
available. Each forecast exposes the extraction rule, recognized IDs and this
limitation in its record details.

Each projected record includes its native field pointer where applicable:

| Graph record | Native detail field |
| --- | --- |
| Frozen question | `contract` |
| Public source | `contract.sources[index]` |
| History value | `contract.shared_history[index]` |
| Evidence statement | `contract.shared_evidence[index]` |
| Shared packet identity | Native digest of `sources`, `shared_history`, `shared_evidence` |
| Attempt | Top-level `id`, execution metadata and artifact references |
| Reference forecast | `response.reference` and `reference_reasoning` |
| Conditional forecast | `response.arms[index]`, matched to `contract.arms[index]` |
| Source review | `reviews[index]` and its `record_artifact` |
| Revision association | `revision_history[index]` and its `association_artifact` |

The graph contains 44 nodes and 87 relationships. Its optional comparison graph
contains the original-attempt subset: 37 nodes and 65 relationships. Both are
projections of the **same later public publication**. The comparison does not
claim that the subset was separately published earlier. Existing immutable nodes
stay identical; the revised attempt, its outputs and associated records are added.
The comparison node shows both native sets of quantiles.

## Reproduce the native checks

Use a separate checkout of Thesis at the exact commit above, with its native
Python dependencies installed. From the Orrery source checkout at
`v0.5.0-preview.2`, run the
[native replay script](https://github.com/TheAxiomFoundation/orrery/blob/v0.5.0-preview.2/examples/thesis-walkthrough-replay.py)
and [projection tests](https://github.com/TheAxiomFoundation/orrery/blob/v0.5.0-preview.2/tests/thesis-walkthrough.test.ts):

```sh
/path/to/thesis/.venv/bin/python examples/thesis-walkthrough-replay.py /path/to/thesis
bun test tests/thesis-walkthrough.test.ts
```

The script reads only `site/lab-publication/` and executes actual Thesis software:
`ConditionalDetail`, native contract/shared-evidence identities,
`validate_response`, `ConditionalReview`, `ConditionalRevision`, and the native
publication revision-closure checker. It checks each copied projection against
the pinned Git commit and its manifest digest, and checks 34 referenced public
artifacts by SHA-256 and byte length. It refuses a different native commit,
modified native code, modified publication bytes, missing dependencies, bad CDFs,
bad IDs, or broken revision closure. It changes no Thesis source or database.
The npm package includes this guide; the fixture, projection, replay script and
tests are available in the linked source checkout and are not included in the package.

This is native **validation of recorded execution**, not a new model run or a
replay of external inference. Passing it establishes internal agreement among
the published bytes and contracts; it does not independently attest origin,
retrieval time, forecast correctness or receipt custody.

## Embed and export

[`examples/thesis-walkthrough.ts`](https://github.com/TheAxiomFoundation/orrery/blob/v0.5.0-preview.2/examples/thesis-walkthrough.ts) exports:

- `thesisWalkthrough`: current graph, validated with `parseGraphDocument`.
- `thesisWalkthroughBaseline`: original-attempt comparison subset.
- `thesisWalkthroughLocation`: selected enacted forecast, focused on the revised run.
- `thesisWalkthroughSteps`: guided source, forecast, review and comparison stops.
- `thesisWalkthroughDescription` and `thesisWalkthroughCaveat`: concise visible copy.

The existing scientific-record `fromThesisRecords` adapter is unchanged: these
conditional records have a different native schema. The example owns their
presentation projection. No new scientific records, credit assignments, Receipt
references, forecast dependencies or verification assessments are fabricated.
