#!/usr/bin/env python3
"""Check captured source/native Axiom bytes; never substitute for the engine."""

import csv
import hashlib
import json
import platform
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def digest(body):
    return hashlib.sha256(body).hexdigest()


def read(path):
    return (ROOT / path).read_bytes()


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    started = now()
    source_path = "examples/mars-signal-horizons.json"
    execution_path = "examples/mars-axiom-run.json"
    source = json.loads(read(source_path))
    execution = json.loads(read(execution_path))
    assert digest(read(source_path)) == execution["sourceFixtureSha256"]
    assert execution["speedOfLightKmPerSecond"] == source["speedOfLight"]["kilometersPerSecond"] == "299792.458"
    artifacts = []

    def include(path, extension, role, expected=None):
        assert path.startswith(("examples/mars-signal", "examples/mars-axiom"))
        assert (ROOT / path).resolve().is_relative_to(ROOT)
        body = read(path)
        sha = digest(body)
        if expected:
            assert sha == expected, path
        artifact = {"sourcePath": path, "extension": extension, "sha256": sha, "byteLength": len(body), "role": role}
        if not any(item["sourcePath"] == path for item in artifacts):
            artifacts.append(artifact)
        return artifact

    for snapshot in source["snapshots"]:
        include("examples/" + snapshot["capture"]["file"], "json", f"Captured JPL Horizons response · {snapshot['epoch'][:10]}", snapshot["capture"]["sha256"])
    include("examples/" + source["speedOfLight"]["capture"]["file"], "txt", "Captured NIST constant page · inert original HTML", source["speedOfLight"]["capture"]["sha256"])
    for artifact in execution["artifacts"]:
        include(artifact["sourcePath"], artifact["extension"], artifact["role"], artifact["sha256"])
    include(source_path, "json", "Source query settings and retrieval record")
    include(execution_path, "json", "Actual Axiom execution record")
    include("examples/mars-signal-capture.py", "txt", "Executed public source capture script", source["scriptSha256"])
    include(execution["generator"]["sourcePath"], "txt", "Executed native Axiom capture script", execution["generator"]["sha256"])
    generator = include("examples/mars-signal-check.py", "txt", "Executed numerical and byte consistency checks")

    checks = []
    assert len(execution["runs"]) == len(source["snapshots"]) == 2
    for snapshot in source["snapshots"]:
        run = next(run for run in execution["runs"] if run["epoch"] == snapshot["epoch"])
        assert run["sourceSha256"] == snapshot["capture"]["sha256"]
        assert run["request"] == json.loads(read(run["requestArtifact"]["sourcePath"]))
        assert run["response"] == json.loads(read(run["responseArtifact"]["sourcePath"]))
        request_input = run["request"]["dataset"]["inputs"][0]
        assert request_input["name"] == execution["moduleTarget"] + "#input.range_km"
        outputs = run["response"]["result"]["results"][0]["outputs"]
        for unit in ("seconds", "minutes"):
            assert outputs[execution["moduleTarget"] + "#fixed_position_one_way_" + unit]["value"]["value"] == run[unit]
        values = snapshot["values"]
        raw_source = json.loads(read("examples/" + snapshot["capture"]["file"]))["result"]
        rows = list(csv.reader(raw_source.split("$$SOE\n", 1)[1].split("$$EOE", 1)[0].strip().splitlines()))
        assert len(rows) == 1
        raw_values = [value.strip() for value in rows[0]]
        for name, index in (("julianDayUT", 0), ("calendarDateUT", 1), ("xKm", 3), ("yKm", 4), ("zKm", 5), ("horizonsLTSeconds", 9), ("rangeKm", 10)):
            assert values[name] == raw_values[index]
        with localcontext() as context:
            context.prec = 50
            distance = Decimal(values["rangeKm"])
            assert distance == Decimal(run["inputRangeKm"]) == Decimal(request_input["value"]["value"])
            expected_seconds = distance / Decimal(source["speedOfLight"]["kilometersPerSecond"])
            norm = sum(Decimal(values[axis + "Km"]) ** 2 for axis in ("x", "y", "z")).sqrt()
            residuals = {
                "nativeSecondsMinusRangeOverC": str(Decimal(run["seconds"]) - expected_seconds),
                "nativeMinutesTimes60MinusSeconds": str(Decimal(run["minutes"]) * 60 - Decimal(run["seconds"])),
                "nativeSecondsMinusHorizonsLT": str(Decimal(run["seconds"]) - Decimal(values["horizonsLTSeconds"])),
                "vectorNormMinusRangeKm": str(norm - distance),
            }
            limits = {"nativeSecondsMinusRangeOverC": "1e-9", "nativeMinutesTimes60MinusSeconds": "1e-9", "nativeSecondsMinusHorizonsLT": "1e-9", "vectorNormMinusRangeKm": "1e-6"}
            for name, value in residuals.items():
                assert abs(Decimal(value)) < Decimal(limits[name]), (name, value)
        checks.append({"epoch": run["epoch"], "status": "passed", "residuals": residuals, "absoluteTolerances": limits,
                       "nativeSeconds": run["seconds"], "nativeMinutes": run["minutes"], "sourceSha256": run["sourceSha256"],
                       "requestSha256": run["requestArtifact"]["sha256"], "responseSha256": run["responseArtifact"]["sha256"]})
    report = {"schemaVersion": "orrery-mars-signal-check/v1", "status": "passed", "startedAt": started, "endedAt": now(),
              "scope": "Local byte identity, source-to-input transcription and numerical consistency; not authentication, independent astronomy validation or outgoing-signal propagation",
              "method": "Python Decimal precision50 with vector norm, independent arithmetic crosscheck and recorded native Axiom/Horizons comparisons",
              "pythonVersion": platform.python_version(), "generator": generator, "checkedArtifactCount": len(artifacts),
              "checkedArtifacts": [{"sourcePath": item["sourcePath"], "sha256": item["sha256"]} for item in artifacts], "checks": checks}
    report_path = "examples/mars-signal-checks.json"
    (ROOT / report_path).write_text(json.dumps(report, indent=2) + "\n")
    include(report_path, "json", "Recorded byte and numerical check results")
    (ROOT / "examples/mars-signal-public-artifacts.json").write_text(json.dumps(artifacts, indent=2) + "\n")
    print(json.dumps({"status": "passed", "checks": checks, "publicArtifacts": len(artifacts)}))


if __name__ == "__main__":
    main()
