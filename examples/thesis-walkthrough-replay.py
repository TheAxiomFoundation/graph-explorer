"""Validate and project a pinned, already-public native Thesis publication.

Run with the Thesis checkout's Python environment. This executes Thesis's real
contracts, CDF validation and revision-closure checker; it never calls a model,
changes the Thesis checkout or reads a private database/artifact directory.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

COMMIT = "1bf1bf2c98f8d313df4f03be175c4e6f1a495c27"
ATTEMPTS = (
    "f8780f671529f6141a5f69c6fd6c8f6b8d58753b3e77b9da59ccb5c365843141",
    "30299a64369382fea583f60b0ccf5ca32a5065c744acf631e2404ac9e74e79e6",
)
repo = Path(sys.argv[1]).resolve()
if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip() != COMMIT:
    raise ValueError(f"Use the published Thesis checkout at {COMMIT}")
subprocess.run(["git", "diff", "--exit-code", "HEAD", "--", "thesis_core"], cwd=repo, check=True)
sys.path.insert(0, str(repo))
from thesis_core.canonical import canonical_sha256
from thesis_core.conditional_contracts import contract_id, shared_evidence_id, validate_response
from thesis_core.conditional_review_contracts import ConditionalReview, ConditionalRevision
from thesis_core.lab_contracts import ConditionalDetail
from thesis_core.lab_publication import _verify_closure


def committed(path):
    """Read only bytes that exactly match the selected public commit."""
    raw = (repo / path).read_bytes()
    expected = subprocess.check_output(["git", "show", f"{COMMIT}:{path}"], cwd=repo)
    if raw != expected:
        raise ValueError(f"Uncommitted publication bytes: {path}")
    return raw


base = "site/lab-publication"
manifest_raw = committed(f"{base}/manifest.json")
manifest = json.loads(manifest_raw)
inventory = {entry["sha256"]: entry for entry in manifest["artifacts"]}
details, raw_details, checked = {}, [], {}


def artifact(ref):
    digest = ref["sha256"]
    if digest not in inventory or inventory[digest]["bytes"] != ref["bytes"]:
        raise ValueError(f"Artifact outside the published allowlist: {digest}")
    raw = committed(f"{base}/blobs/{digest}")
    if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(f"Artifact integrity mismatch: {digest}")
    checked[digest] = inventory[digest]
    return raw


for identity in ATTEMPTS:
    entry = next(item for item in manifest["attempts"] if item["id"] == identity)
    raw = committed(f"{base}/blobs/{entry['detail']['sha256']}")
    if len(raw) != entry["detail"]["bytes"] or hashlib.sha256(raw).hexdigest() != entry["detail"]["sha256"]:
        raise ValueError("Publication projection integrity mismatch")
    data = json.loads(raw)
    detail = ConditionalDetail.model_validate_json(raw)
    assert detail.id == identity
    assert detail.contract_id == contract_id(detail.contract)
    assert detail.shared_evidence_id == shared_evidence_id(detail.contract)
    assert detail.response is not None
    validate_response(detail.contract, detail.response)
    for ref in data["artifacts"]:
        artifact(ref)
    for review in data["reviews"]:
        payload = json.loads(artifact(review["record_artifact"]))
        ConditionalReview.model_validate_json(json.dumps(payload))
        assert canonical_sha256(payload) == review["id"]
        artifact(review["report"])
    for revision in data["revision_history"]:
        if revision["association_artifact"]:
            payload = json.loads(artifact(revision["association_artifact"]))
            ConditionalRevision.model_validate_json(json.dumps(payload))
            assert canonical_sha256(payload) == revision["association_artifact"]["sha256"]
            artifact(revision["feedback"])
    details[identity] = detail
    raw_details.append(data)

_verify_closure(details)
selected = {item["id"]: item["detail"] for item in manifest["attempts"] if item["id"] in ATTEMPTS}
output = {
    "source": {
        "repository": "https://github.com/ThesisInstitute/thesis",
        "commit": COMMIT,
        "publicationPath": base,
        "publicationSha256": hashlib.sha256(manifest_raw).hexdigest(),
        "publishedAt": manifest["generated_at"],
        "nativePublicationCodeRevision": manifest["code_revision"],
        "projections": selected,
        "checks": ["committed-byte parity", "publication artifact SHA-256 and length", "ConditionalDetail", "native contract and shared-evidence identities", "validate_response (original 201-point CDFs)", "ConditionalReview", "ConditionalRevision", "native publication revision closure"],
        "checkedArtifactCount": len(checked),
        "checkedArtifactBytes": sum(item["bytes"] for item in checked.values()),
        "limitations": "Already-recorded exploratory operator forecasts. Source-review issues remain. No new model execution, source retrieval, prospective qualification, causal identification or Receipt verification. Artifact consistency checks do not prove external origin or claim correctness.",
    },
    "details": raw_details,
}
destination = Path(__file__).with_name("thesis-walkthrough-publication.json")
destination.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"output": str(destination), "attempts": len(details), "checkedArtifacts": len(checked), "sha256": hashlib.sha256(destination.read_bytes()).hexdigest()}))
