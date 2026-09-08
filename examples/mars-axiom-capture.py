"""Capture the Mars example through a pinned real Axiom CLI; no physics evaluator.

The operator supplies the executable explicitly. Source observations never supply
commands. Decimal() below changes notation only; all divisions run inside Axiom.
Existing captures are immutable: use fresh --artifacts and --record paths.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CORE_REVISION = "8ac3a54f60fa3737166ff0c986d9660f34a25435"
ENGINE_REVISION = "d142c645917817cf590e036fb99f99b2d4780e1a"
TARGET = "zz:policies/orrery/mars-light-time"


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def capture(engine: Path, artifacts: Path, record: Path) -> dict:
    if artifacts.exists() or record.exists():
        raise ValueError("Use fresh artifact and record paths; recorded executions are not overwritten")
    source_path = ROOT / "examples/mars-signal-horizons.json"
    source = json.loads(source_path.read_bytes())
    assert source["speedOfLight"]["kilometersPerSecond"] == "299792.458"
    module_path = ROOT / "examples/mars-axiom.rulespec.yaml"
    spec_path = ROOT / "examples/mars-axiom-build.json"
    spec = json.loads(spec_path.read_bytes())
    assert spec["root"] == TARGET and spec["modules"] == {TARGET: module_path.read_text()}
    for observation in [*source["snapshots"], source["speedOfLight"]]:
        ref = observation["capture"]
        path = (ROOT / "examples" / ref["file"]).resolve()
        assert path.is_relative_to(ROOT / "examples")
        raw = path.read_bytes()
        assert digest(raw) == ref["sha256"] and len(raw) == ref["byteLength"]
    artifacts.mkdir(parents=True)
    allowlist: list[dict] = []

    def admit(path: Path, role: str) -> dict:
        raw = path.read_bytes()
        extension = path.suffix.removeprefix(".")
        assert extension in {"json", "yaml", "txt"}
        item = {"sourcePath": path.relative_to(ROOT).as_posix(), "sha256": digest(raw),
                "byteLength": len(raw), "extension": extension,
                "mediaType": {"json": "application/json", "yaml": "text/yaml", "txt": "text/plain"}[extension],
                "role": role}
        if not any(existing["sha256"] == item["sha256"] for existing in allowlist):
            allowlist.append(item)
        return item

    def save(raw: bytes, role: str) -> dict:
        path = artifacts / f"{digest(raw)}.json"
        if not path.exists():
            path.write_bytes(raw)
        return admit(path, role)

    def native(arguments: list[str], role: str) -> tuple[dict, dict]:
        completed = subprocess.run([str(engine), *arguments], capture_output=True, timeout=60)
        if completed.returncode:
            raise RuntimeError(f"{role} failed: {(completed.stderr or completed.stdout).decode()}")
        result = json.loads(completed.stdout)
        return result, save(completed.stdout, role)

    capabilities, capabilities_ref = native(["capabilities"], "native runtime capabilities")
    assert capabilities["engine"]["revision"] == ENGINE_REVISION
    assert capabilities["engine"]["version"] == "0.2.2"
    assert capabilities["engine"]["artifact_format_version"] == 2
    assert capabilities["engine"]["execution_host_sha256"] == digest(engine.read_bytes())
    module_ref = admit(module_path, "authored astronomy RuleSpec source; not a law encoding")
    spec_ref = admit(spec_path, "explicit native build request")
    runs = []
    with tempfile.TemporaryDirectory(prefix="orrery-mars-native-") as scratch:
        bundle_path = Path(scratch) / "bundle.json"
        identity, build_ref = native(["build", "--spec", str(spec_path), "--out", str(bundle_path)], "native compile response")
        bundle_raw = bundle_path.read_bytes()
        bundle = json.loads(bundle_raw)
        bundle_ref = save(bundle_raw, "unsigned native development bundle")
        artifact_ref = save(bundle["artifact_json"].encode(), "native compiled RuleSpec artifact")
        assert artifact_ref["sha256"] == identity["artifact_sha256"]
        assert bundle["modules"][TARGET] == module_path.read_text()
        assert bundle["manifest"]["source_hashes"][TARGET] == module_ref["sha256"]
        verification, verify_ref = native(["verify", "--bundle", str(bundle_path), "--expect", identity["bundle_sha256"]], "native bundle integrity and rebuild result; not authentication")
        assert verification["ok"] is True
        for snapshot in source["snapshots"]:
            day = date.fromisoformat(snapshot["epoch"][:10])
            interval = {"start": day.isoformat(), "end": day.isoformat()}
            # Lossless transcription of a supplied scientific-notation literal.
            range_km = format(Decimal(snapshot["values"]["rangeKm"]), "f")
            request = {"mode": "explain", "dataset": {"inputs": [{
                "name": TARGET + "#input.range_km", "entity": "Observation", "entity_id": "mars-range:" + snapshot["epoch"],
                "interval": interval, "value": {"kind": "decimal", "value": range_km}}], "relations": []},
                "queries": [{"entity_id": "mars-range:" + snapshot["epoch"], "period": {"period_kind": "custom", "name": "Day", **interval},
                             "outputs": [TARGET + "#fixed_position_one_way_seconds", TARGET + "#fixed_position_one_way_minutes"]}]}
            request_ref = save((json.dumps(request, indent=2) + "\n").encode(), "exact native execution request")
            started = now()
            response, response_ref = native(["run", "--bundle", str(bundle_path), "--expect", identity["bundle_sha256"],
                                             "--request", str(ROOT / request_ref["sourcePath"])], "full native execution result and trace; unsigned")
            ended = now()
            assert response["assurance"] == "development_unsigned"
            assert response["context"]["artifact_sha256"] == artifact_ref["sha256"]
            assert response["result"]["metadata"]["actual_mode"] == "explain"
            outputs = response["result"]["results"][0]["outputs"]
            values = {}
            for unit in ["seconds", "minutes"]:
                output = outputs[TARGET + "#fixed_position_one_way_" + unit]
                assert output["kind"] == "scalar" and output["value"]["kind"] == "decimal"
                values[unit] = output["value"]["value"]
            runs.append({"epoch": snapshot["epoch"], "inputRangeKm": range_km,
                         "inputRangeOriginal": snapshot["values"]["rangeKm"], "sourceSha256": snapshot["capture"]["sha256"],
                         "seconds": values["seconds"], "minutes": values["minutes"], "startedAt": started, "endedAt": ended,
                         "request": request, "response": response, "requestArtifact": request_ref, "responseArtifact": response_ref})
    result = {"schemaVersion": "orrery-mars-axiom-run/v1", "calculation": "Fixed-position geometric one-way range/c; not an outbound retarded-time or network-latency prediction",
              "runtime": {"name": "axiom-core over axiom-rules-engine", "repository": "https://github.com/TheAxiomFoundation/axiom-core",
                          "revision": CORE_REVISION, "capabilities": capabilities, "capabilitiesArtifact": capabilities_ref},
              "assurance": "Recorded local execution through real Axiom; unsigned. Hashes establish byte identity, not authorship, custody, or scientific correctness.",
              "timestampScope": "Local process clock; not an independent or signed timestamp",
              "moduleTarget": TARGET, "moduleMeaning": "zz is a demonstration namespace. The compiler requires a supported path prefix; policies here does not claim a law encoding.",
              "sourceFixtureSha256": digest(source_path.read_bytes()), "speedOfLightKmPerSecond": "299792.458",
              "moduleArtifact": module_ref, "buildSpecArtifact": spec_ref, "buildResultArtifact": build_ref,
              "bundleArtifact": bundle_ref, "compiledArtifact": artifact_ref, "verificationArtifact": verify_ref,
              "buildIdentity": identity, "runs": runs, "artifacts": allowlist,
              "generator": {"sourcePath": "examples/mars-axiom-capture.py", "sha256": digest(Path(__file__).read_bytes())}}
    record.write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path, help="Explicit trusted axiom-core CLI built from the documented public source pin")
    parser.add_argument("--artifacts", type=Path, default=ROOT / "examples/mars-axiom-artifacts")
    parser.add_argument("--record", type=Path, default=ROOT / "examples/mars-axiom-run.json")
    options = parser.parse_args()
    result = capture(options.engine.resolve(), options.artifacts.resolve(), options.record.resolve())
    print(json.dumps({"record": str(options.record), "artifactCount": len(result["artifacts"]),
                      "runs": [{key: run[key] for key in ["epoch", "inputRangeKm", "seconds", "minutes"]} for run in result["runs"]]}, indent=2))
