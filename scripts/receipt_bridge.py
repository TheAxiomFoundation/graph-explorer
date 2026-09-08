#!/usr/bin/env python3
"""Local, explicit adapter to Receipt's real offline verifier (Python 3.11+).

Graph files never supply executable configuration. The operator separately
chooses a trusted Receipt interpreter, Python verification spec and corpus root.
The worker calls Receipt's verification API because its stock JSON CLI currently
reports corpus counts, while the API exposes the actual checked file digests.
No signing, timestamp or cryptographic verification is implemented here.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from typing import Any

FORMAT = "graph-explorer/receipt-assessment/v1"
BINDING_FORMAT = "graph-explorer/receipt-binding/v1"
SCOPE = (
    "Artifact custody. Association with graph subjects is host-declared. "
    "This does not verify graph projection correctness, authorship of graph "
    "metadata, rule correctness, or whether declared gates actually passed."
)
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
RECEIPT_KEYS = {"id", "label", "subjects", "artifactIds", "uri", "sha256", "verifier"}


class Refusal(ValueError):
    """A graph, binding, or report cannot support the requested assessment."""


class NoBinding(Refusal):
    """The verifier cannot expose the necessary subject/artifact evidence."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise Refusal(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_json(data: bytes | str) -> Any:
    return json.loads(data, object_pairs_hook=unique_object)


def sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not DIGEST.fullmatch(value):
        raise Refusal(f"{label} must be a lowercase SHA-256 digest")
    return value


def records(value: Any, label: str) -> dict[str, dict[str, Any]]:
    if not isinstance(value, list):
        raise Refusal(f"{label} must be an array")
    result: dict[str, dict[str, Any]] = {}
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            raise Refusal(f"Invalid {label} identity")
        if item["id"] in result:
            raise Refusal(f"Duplicate {label} identity: {item['id']}")
        result[item["id"]] = item
    return result


def subject_set(value: Any) -> set[tuple[str, str, str]]:
    if not isinstance(value, list) or not value:
        raise Refusal("At least one subject with an immutable revision is required")
    result: set[tuple[str, str, str]] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {"type", "id", "revision"}:
            raise Refusal("Each bound subject requires only type, id and revision")
        if item["type"] not in {"node", "edge", "activity"}:
            raise Refusal("Unknown subject type")
        if any(not isinstance(item[k], str) or not item[k] for k in ("id", "revision")):
            raise Refusal("Each subject requires a nonempty identity and revision")
        key = (item["type"], item["id"], item["revision"])
        if key in result:
            raise Refusal("Duplicate subject")
        result.add(key)
    return result


def relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise Refusal("Bound artifact path must be a relative POSIX path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value:
        raise Refusal("Bound artifact path must be normalized and within the corpus")
    return value


def validate_binding(graph: dict[str, Any], raw: bytes, receipt_id: str,
                     binding: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Validate operator-declared associations before executing the trusted spec."""
    if graph.get("schemaVersion") != "graph-explorer/v1":
        raise Refusal("Unsupported graph schema")
    receipt = records(graph.get("receipts", []), "receipts").get(receipt_id)
    if receipt is None:
        raise Refusal("Receipt identity is absent from this graph")
    if set(receipt) - RECEIPT_KEYS:
        raise Refusal("Graph receipt configuration refused: only references are allowed, never commands or verdicts")
    if receipt.get("verifier") not in (None, "receipt"):
        raise Refusal("Unsupported graph verifier identifier; graph commands are never executed")
    allowed = {"schemaVersion", "documentSha256", "receiptId", "receiptSha256", "specSha256", "subjects", "artifacts"}
    if not isinstance(binding, dict) or set(binding) != allowed or binding["schemaVersion"] != BINDING_FORMAT:
        raise Refusal("Invalid local binding schema")
    if sha(binding["documentSha256"], "documentSha256") != digest(raw):
        raise Refusal("Graph snapshot digest does not match the local binding")
    if binding["receiptId"] != receipt_id:
        raise Refusal("Receipt identity does not match the local binding")
    if sha(binding["receiptSha256"], "receiptSha256") != sha(receipt.get("sha256"), "receipt.sha256"):
        raise Refusal("Receipt digest does not match the local binding")
    sha(binding["specSha256"], "specSha256")
    subjects = subject_set(binding["subjects"])
    if subjects != subject_set(receipt.get("subjects")):
        raise Refusal("Receipt subjects do not match the local binding")
    collections = {
        "node": records(graph.get("nodes", []), "nodes"),
        "edge": records(graph.get("edges", []), "edges"),
        "activity": records(graph.get("activities", []), "activities"),
    }
    for kind, identity, revision in subjects:
        item = collections[kind].get(identity)
        if item is None or item.get("revision") != revision:
            raise Refusal("Subject identity or revision does not match this graph snapshot")
    artifact_map = records(binding["artifacts"], "bound artifacts")
    graph_artifacts = records(graph.get("artifacts", []), "graph artifacts")
    declared_ids = receipt.get("artifactIds")
    if (not isinstance(declared_ids, list) or not declared_ids
            or any(not isinstance(x, str) for x in declared_ids)
            or len(set(declared_ids)) != len(declared_ids)
            or set(declared_ids) != set(artifact_map)):
        raise Refusal("Receipt artifact identities do not match the local binding")
    covered: set[tuple[str, str, str]] = set()
    paths: set[str] = set()
    for artifact in artifact_map.values():
        if set(artifact) != {"id", "path", "sha256", "subjects"}:
            raise Refusal("Each binding artifact requires only id, path, sha256, subjects")
        path = relative_path(artifact["path"])
        if path in paths:
            raise Refusal("Duplicate bound artifact path")
        paths.add(path)
        expected = sha(artifact["sha256"], "artifact.sha256")
        declared = graph_artifacts.get(artifact["id"])
        if declared is None or sha(declared.get("sha256"), "graph artifact.sha256") != expected:
            raise Refusal("Artifact identity or digest does not match this graph")
        association = subject_set(artifact["subjects"])
        if not association.issubset(subjects):
            raise Refusal("Artifact association includes an unbound subject")
        covered.update(association)
    if covered != subjects:
        raise Refusal("Every subject needs an explicit checked artifact association")
    return receipt, list(artifact_map.values())


def run_worker(python: Path, spec: Path, root: Path, spec_sha: str,
               base_ref: str | None, timeout: float) -> subprocess.CompletedProcess[str]:
    # Fixed program and arguments. -I removes CWD/PYTHONPATH import injection.
    # Do not resolve the interpreter symlink: venv identity depends on its path.
    command = [str(python.absolute()), "-I", str(Path(__file__).resolve()), "--_worker"]
    request = {"spec": str(spec.resolve()), "root": str(root.resolve()),
               "specSha256": spec_sha, "baseRef": base_ref}
    with tempfile.TemporaryDirectory(prefix="graph-receipt-worker-") as cwd:
        return subprocess.run(command, input=json.dumps(request), text=True,
                              capture_output=True, check=False, timeout=timeout, cwd=cwd)


def worker_main() -> int:
    """Expose checked files directly from Receipt's own verification result."""
    try:
        from receipt.verify import load_spec, result_to_dict, run_verification
    except ImportError as exc:
        print(json.dumps({"bridgeError": "unavailable", "detail": f"Receipt import unavailable: {exc}"}))
        return 2
    try:
        request = parse_json(sys.stdin.read())
        spec_path = Path(request["spec"])
        if digest(spec_path.read_bytes()) != request["specSha256"]:
            raise Refusal("Trusted spec digest changed before loading")
        spec, spec_sha = load_spec(spec_path)
        if spec_sha != request["specSha256"]:
            raise Refusal("Loaded spec digest differs from the configured pin")
        result = run_verification(Path(request["root"]), spec, spec_path=spec_path,
                                  spec_sha256=spec_sha, base_ref=request["baseRef"])
        report = result_to_dict(result)
        report["checkedFiles"] = [] if result.corpus is None else [
            {"path": item.path, "sha256": item.sha256, "kind": kind}
            for kind, entries in (("content", result.corpus.content), ("attested", result.corpus.attested))
            for item in entries
        ]
        if digest(spec_path.read_bytes()) != spec_sha:
            raise Refusal("Trusted spec changed during verification")
        print(json.dumps(report))
        return 0 if result.ok else 1
    except Exception as exc:
        print(json.dumps({"verdict": "FAIL", "failure": f"{type(exc).__name__}: {exc}"}))
        return 1


def check_report(report: Any, spec: Path, root: Path, binding: dict[str, Any],
                 artifacts: list[dict[str, Any]]) -> None:
    if not isinstance(report, dict) or report.get("verdict") != "PASS":
        raise Refusal("Receipt verifier did not return PASS")
    if not {"custody", "binding", "declaration"}.issubset(set(report.get("passesCompleted", []))):
        raise Refusal("Receipt report lacks the required completed passes")
    passes = report.get("passes")
    if not isinstance(passes, list) or any(p.get("ok") is not True for p in passes):
        raise Refusal("Receipt report includes unsuccessful or malformed passes")
    if not {"custody", "binding", "declaration"}.issubset({p.get("name") for p in passes}):
        raise Refusal("Receipt report pass details are incomplete")
    if not isinstance(report.get("receiptVersion"), str) or not report["receiptVersion"]:
        raise Refusal("Receipt report does not identify the verifier version")
    if report.get("spec", {}).get("sha256") != binding["specSha256"]:
        raise Refusal("Receipt report spec digest mismatch")
    if report.get("spec", {}).get("path") != str(spec.resolve()) or report.get("root") != str(root.resolve()):
        raise Refusal("Receipt report refers to another spec or corpus root")
    if report.get("chain", {}).get("headSha256") != binding["receiptSha256"]:
        raise Refusal("Receipt report head digest does not match this receipt")
    files = report.get("checkedFiles")
    if not isinstance(files, list):
        raise NoBinding("Receipt report has no per-file binding evidence; corpus PASS alone cannot verify graph subjects")
    by_path: dict[str, str] = {}
    for item in files:
        path = relative_path(item.get("path"))
        if path in by_path:
            raise Refusal("Receipt report contains duplicate checked paths")
        by_path[path] = sha(item.get("sha256"), "checked file digest")
    for artifact in artifacts:
        if by_path.get(artifact["path"]) != artifact["sha256"]:
            raise Refusal("Bound artifact is absent from Receipt's checked files or its digest differs")


def assess(graph_path: Path, receipt_id: str, bindings_path: Path | None,
           python: Path | None, spec: Path | None, root: Path | None,
           base_ref: str | None = None, timeout: float = 120) -> dict[str, Any]:
    raw = graph_path.read_bytes()
    assessment: dict[str, Any] = {
        "receiptId": receipt_id, "status": "unchecked", "verifier": "receipt",
        "documentSha256": digest(raw), "checkedAt": datetime.now(timezone.utc).isoformat(),
        "scope": SCOPE,
    }
    output: dict[str, Any] = {"schemaVersion": FORMAT, "assessments": [assessment]}
    try:
        graph = parse_json(raw)
        if not isinstance(graph, dict):
            raise Refusal("Graph must be an object")
        receipt = records(graph.get("receipts", []), "receipts").get(receipt_id)
        if receipt is None:
            raise Refusal("Receipt identity is absent from this graph")
        if set(receipt) - RECEIPT_KEYS or receipt.get("verifier") not in (None, "receipt"):
            raise Refusal("Graph receipt configuration refused: commands, verdicts and executable verifier settings are not accepted")
        if bindings_path is None:
            assessment["detail"] = "No separately supplied artifact-to-subject binding; graph receipt declarations are unchecked."
            return output
        binding = parse_json(bindings_path.read_bytes())
        receipt, artifacts = validate_binding(graph, raw, receipt_id, binding)
        if python is None or spec is None or root is None:
            assessment.update(status="unavailable", detail="Explicit Receipt interpreter, trusted spec and corpus root are required.")
            return output
        if not root.is_dir() or not spec.is_file():
            assessment.update(status="unavailable", detail="The configured corpus root or trusted spec is unavailable.")
            return output
        if digest(spec.read_bytes()) != binding["specSha256"]:
            raise Refusal("Trusted verification spec digest does not match its local pin")
        completed = run_worker(python, spec, root, binding["specSha256"], base_ref, timeout)
        try:
            report = parse_json(completed.stdout)
        except (ValueError, TypeError) as exc:
            raise Refusal("Receipt verifier returned no usable JSON report") from exc
        output["report"] = report
        if isinstance(report, dict) and report.get("bridgeError") == "unavailable":
            assessment.update(status="unavailable", detail=report.get("detail", "Receipt unavailable"))
            return output
        if completed.returncode != 0:
            raise Refusal("Receipt verification failed; see the complete report")
        check_report(report, spec, root, binding, artifacts)
        if graph_path.read_bytes() != raw:
            raise Refusal("Graph snapshot changed during verification")
        if digest(spec.read_bytes()) != binding["specSha256"]:
            raise Refusal("Trusted spec changed during verification")
        assessment.update(
            status="verified", subjects=binding["subjects"],
            receiptSha256=report["chain"]["headSha256"],
            artifacts=[{"id": a["id"], "sha256": a["sha256"]} for a in artifacts],
            detail=f"receipt {report.get('receiptVersion', 'unknown')}; spec SHA-256 {binding['specSha256']}; release {binding['receiptSha256']}. Checked artifact bytes; graph associations are host-declared.",
        )
        output["binding"] = binding
    except NoBinding as exc:
        assessment.update(status="unchecked", detail=str(exc))
    except (FileNotFoundError, PermissionError, subprocess.TimeoutExpired) as exc:
        assessment.update(status="unavailable", detail=f"Verifier or local input unavailable: {type(exc).__name__}: {exc}")
    except (Refusal, ValueError, TypeError, KeyError, AttributeError, OSError) as exc:
        assessment.update(status="failed", detail=str(exc))
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, required=True)
    parser.add_argument("--receipt-id", required=True)
    parser.add_argument("--bindings", type=Path, help="Separately reviewed artifact-to-subject binding JSON")
    parser.add_argument("--receipt-python", type=Path, help="Trusted Python environment with Receipt installed")
    parser.add_argument("--spec", type=Path, help="Reviewed local Python Receipt verification spec (executes code)")
    parser.add_argument("--root", type=Path, help="Local corpus root")
    parser.add_argument("--base-ref", help="Optional previously recorded history checkpoint")
    parser.add_argument("--timeout", type=float, default=120)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.output and args.output.resolve() in {p.resolve() for p in (args.graph, args.bindings, args.spec) if p}:
        parser.error("Output must not overwrite a graph, binding, or trusted spec")
    if args.output and args.root and args.output.resolve().is_relative_to(args.root.resolve()):
        parser.error("Write the report outside the verified corpus root")
    try:
        output = assess(args.graph, args.receipt_id, args.bindings, args.receipt_python,
                        args.spec, args.root, args.base_ref, args.timeout)
    except OSError as exc:
        print(f"receipt bridge: cannot read graph: {exc}", file=sys.stderr)
        return 2
    encoded = json.dumps(output, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(encoded)
    else:
        print(encoded, end="")
    return 0 if output["assessments"][0]["status"] == "verified" else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--_worker"]:
        raise SystemExit(worker_main())
    raise SystemExit(main())
