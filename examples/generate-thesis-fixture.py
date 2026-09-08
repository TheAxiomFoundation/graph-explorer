"""Run with Thesis's installed Python: generate-thesis-fixture.py /path/to/thesis.

Runs the actual Thesis capture adapter on its committed test fixture. This is a
local replay of repository fixture bytes, never a new live observation or forecast.
"""
from pathlib import Path
import datetime as dt
import hashlib
import json
import subprocess
import sys
import tempfile

repo = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(repo))
from thesis_core.adapters import HttpResponse, capture
from thesis_core.artifacts import LocalArtifactStore
from thesis_core.contracts import LINK_SPECS, RECORD_TYPES, record_links

fixture_path = "tests/fixtures/international/statcan_cpi_v41690973.json"
raw = (repo / fixture_path).read_bytes()
when = dt.datetime.now(dt.timezone.utc)
with tempfile.TemporaryDirectory(prefix="graph-explorer-thesis-") as tmp:
    result = capture(
        "statcan-cpi-yoy", LocalArtifactStore(tmp), mode="replay",
        fetch=lambda request: HttpResponse(raw, request.url),
        retrieved_at=when, accepted_at=when,
    )
    if result.status != "captured":
        raise RuntimeError(result.errors)
    records = [result.source, *result.exchanges, *result.observations]
    payload = {
        "source": {
            "repository": "https://github.com/ThesisInstitute/thesis",
            "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
            "fixturePath": fixture_path,
            "fixtureSha256": hashlib.sha256(raw).hexdigest(),
            "adapter": "thesis_core.adapters.capture(statcan-cpi-yoy, mode=replay)",
            "generatedAt": when.isoformat(),
            "limitations": "Local native-adapter replay of committed test fixture bytes. Fixture historical accuracy and original retrieval are not verified. No network retrieval, forecast generation, publication, timestamp proof, or custody verification was performed.",
        },
        "records": [{"id": item.id, "kind": item.kind, "payload": item.canonical_payload()} for item in records],
        "nativeLinks": [{"recordId": item.id, "fieldPath": link.field_path, "relation": link.relation, "targetId": link.target_id, "targetKind": link.target_kind} for item in records for link in record_links(item)],
    }
out = Path(__file__).parent / "fixtures" / "thesis-source-replay.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(payload, indent=2) + "\n")
registry = {
    "source": {"repository": payload["source"]["repository"], "commit": payload["source"]["commit"], "path": "thesis_core/contracts.py"},
    "links": {kind: [dict(field=s.field, target_kind=s.target_kind, relation=s.relation, many=s.many, required=s.required) for s in specs] for kind, specs in LINK_SPECS.items()},
    "artifactFields": {kind: list(cls.artifact_fields) for kind, cls in RECORD_TYPES.items()},
}
(Path(__file__).parents[1] / "src/adapters/thesis-registry.json").write_text(json.dumps(registry, indent=2) + "\n")
print(f"Wrote {out}: {len(records)} records from the native Thesis adapter")
