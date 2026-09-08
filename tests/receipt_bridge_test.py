"""Boundary tests: only real verifier output plus a local binding can verify.

These tests simulate subprocess outputs to exercise refusal paths. A separate
documented smoke test uses Receipt's real signed/witnessed corpus fixture.
"""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "scripts/receipt_bridge.py"
SPEC = importlib.util.spec_from_file_location("receipt_bridge", MODULE)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class ReceiptBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.graph_path = self.root / "graph.json"
        self.binding_path = self.root / "binding.json"
        self.spec = self.root / "trusted.py"
        self.spec.write_text("# trusted spec selected by the operator\n")
        self.subject = {"type": "node", "id": "rule", "revision": "immutable-1"}
        self.artifact_sha = "a" * 64
        self.head_sha = "b" * 64
        self.graph = {
            "schemaVersion": "graph-explorer/v1", "id": "test", "title": "Test",
            "nodes": [{"id": "rule", "label": "Rule", "kind": "rule", "revision": "immutable-1"}],
            "edges": [],
            "artifacts": [{"id": "source", "label": "Source", "sha256": self.artifact_sha}],
            "receipts": [{"id": "r", "label": "Receipt", "verifier": "receipt",
                          "sha256": self.head_sha, "subjects": [self.subject], "artifactIds": ["source"]}],
        }
        self.binding = {
            "schemaVersion": bridge.BINDING_FORMAT, "documentSha256": "",
            "receiptId": "r", "receiptSha256": self.head_sha,
            "specSha256": bridge.digest(self.spec.read_bytes()), "subjects": [self.subject],
            "artifacts": [{"id": "source", "path": "rules/rule.yaml", "sha256": self.artifact_sha,
                           "subjects": [self.subject]}],
        }
        self.report = {
            "verdict": "PASS", "receiptVersion": "0.5.1", "root": str(self.root.resolve()),
            "spec": {"path": str(self.spec.resolve()), "sha256": self.binding["specSha256"]},
            "chain": {"headSha256": self.head_sha},
            "passesCompleted": ["custody", "binding", "declaration"],
            "passes": [{"name": name, "ok": True} for name in ("custody", "binding", "declaration")],
            "checkedFiles": [{"path": "rules/rule.yaml", "sha256": self.artifact_sha, "kind": "content"}],
        }
        self.save()

    def save(self, pin_graph=True):
        self.graph_path.write_text(json.dumps(self.graph))
        if pin_graph:
            self.binding["documentSha256"] = bridge.digest(self.graph_path.read_bytes())
        self.binding_path.write_text(json.dumps(self.binding))

    def assess(self, report=None, returncode=0, side_effect=None):
        completed = subprocess.CompletedProcess([], returncode, json.dumps(self.report if report is None else report), "")
        with patch.object(bridge, "run_worker", return_value=completed, side_effect=side_effect) as mock:
            result = bridge.assess(self.graph_path, "r", self.binding_path, Path(sys.executable), self.spec, self.root)
        return result, mock

    def test_verified_scope_is_artifact_custody_and_binds_all_identities(self):
        result, mock = self.assess()
        assessment = result["assessments"][0]
        self.assertEqual(assessment["status"], "verified")
        self.assertEqual(assessment["documentSha256"], bridge.digest(self.graph_path.read_bytes()))
        self.assertEqual(assessment["receiptSha256"], self.head_sha)
        self.assertEqual(assessment["subjects"], [self.subject])
        self.assertEqual(assessment["artifacts"], [{"id": "source", "sha256": self.artifact_sha}])
        self.assertIn("host-declared", assessment["scope"])
        self.assertIn("does not verify", assessment["scope"])
        mock.assert_called_once()

    def test_graph_command_and_executable_verifier_configuration_are_refused(self):
        for key, value in (("command", "touch /tmp/pwn"), ("python", "/evil"),
                           ("spec", "evil.py"), ("status", "verified"), ("verifier", "sh -c evil")):
            with self.subTest(key=key):
                original = copy.deepcopy(self.graph)
                self.graph["receipts"][0][key] = value
                self.save()
                result, mock = self.assess()
                self.assertEqual(result["assessments"][0]["status"], "failed")
                mock.assert_not_called()
                self.graph = original

    def test_graph_metadata_pass_never_becomes_a_verdict(self):
        self.graph["metadata"] = {"verdict": "PASS", "verified": True, "assessment": {"status": "verified"}}
        self.save()
        with patch.object(bridge, "run_worker") as mock:
            result = bridge.assess(self.graph_path, "r", None, None, None, None)
        self.assertEqual(result["assessments"][0]["status"], "unchecked")
        mock.assert_not_called()

    def test_graph_snapshot_change_refused_before_execution(self):
        self.graph["title"] = "Changed"
        self.save(pin_graph=False)
        result, mock = self.assess()
        self.assertEqual(result["assessments"][0]["status"], "failed")
        mock.assert_not_called()

    def test_subject_identity_revision_and_artifact_mismatches_refused(self):
        mutations = [
            lambda: self.graph["nodes"][0].update(revision="new-revision"),
            lambda: self.binding.update(subjects=[{**self.subject, "id": "unrelated"}]),
            lambda: self.graph["artifacts"][0].update(sha256="c" * 64),
            lambda: self.binding.update(receiptId="another-receipt"),
            lambda: self.graph["receipts"][0].update(sha256="d" * 64),
            lambda: self.binding["artifacts"][0].update(subjects=[{**self.subject, "id": "unrelated"}]),
            lambda: self.binding["artifacts"][0].update(path="../outside.yaml"),
        ]
        for mutation in mutations:
            original_graph, original_binding = copy.deepcopy(self.graph), copy.deepcopy(self.binding)
            mutation()
            self.save()
            result, mock = self.assess()
            self.assertEqual(result["assessments"][0]["status"], "failed")
            mock.assert_not_called()
            self.graph, self.binding = original_graph, original_binding

    def test_missing_immutable_revision_refused(self):
        self.graph["receipts"][0]["subjects"] = [{"id": "rule", "type": "node"}]
        self.save()
        result, mock = self.assess()
        self.assertEqual(result["assessments"][0]["status"], "failed")
        mock.assert_not_called()

    def test_spec_pin_mismatch_refused_before_execution(self):
        self.spec.write_text("raise RuntimeError('must not execute')")
        result, mock = self.assess()
        self.assertEqual(result["assessments"][0]["status"], "failed")
        mock.assert_not_called()

    def test_failure_and_nonzero_exit_cannot_verify_even_with_pass_payload(self):
        for report, code in (({"verdict": "FAIL"}, 1), (self.report, 1), ({"verdict": "FAIL"}, 0)):
            with self.subTest(report=report, code=code):
                result, _ = self.assess(report, code)
                self.assertEqual(result["assessments"][0]["status"], "failed")

    def test_checked_file_head_spec_and_root_must_match(self):
        candidates = []
        for key, value in (("chain", {"headSha256": "c" * 64}), ("root", "/another/root"),
                           ("spec", {"path": str(self.spec), "sha256": "d" * 64}),
                           ("checkedFiles", [{"path": "unrelated.yaml", "sha256": self.artifact_sha}]),
                           ("checkedFiles", [{"path": "rules/rule.yaml", "sha256": "f" * 64}]),
                           ("passes", [])):
            report = copy.deepcopy(self.report)
            report[key] = value
            candidates.append(report)
        for report in candidates:
            result, _ = self.assess(report)
            self.assertEqual(result["assessments"][0]["status"], "failed")

    def test_stock_cli_pass_without_checked_files_is_unchecked(self):
        del self.report["checkedFiles"]
        result, _ = self.assess()
        self.assertEqual(result["assessments"][0]["status"], "unchecked")

    def test_missing_runtime_and_timeout_are_unavailable(self):
        for error in (FileNotFoundError("missing receipt interpreter"), subprocess.TimeoutExpired("receipt", 1)):
            result, _ = self.assess(side_effect=error)
            self.assertEqual(result["assessments"][0]["status"], "unavailable")
        result, _ = self.assess({"bridgeError": "unavailable", "detail": "Receipt package absent"}, 2)
        self.assertEqual(result["assessments"][0]["status"], "unavailable")

    def test_graph_change_during_verification_refused(self):
        def change_graph(*_):
            self.graph_path.write_text(self.graph_path.read_text() + "\n")
            return subprocess.CompletedProcess([], 0, json.dumps(self.report), "")
        result, _ = self.assess(side_effect=change_graph)
        self.assertEqual(result["assessments"][0]["status"], "failed")

    def test_invalid_or_duplicate_json_refused(self):
        for raw in ('{"verdict":"PASS","verdict":"FAIL"}', "not JSON"):
            with patch.object(bridge, "run_worker", return_value=subprocess.CompletedProcess([], 0, raw, "")):
                result = bridge.assess(self.graph_path, "r", self.binding_path, Path(sys.executable), self.spec, self.root)
            self.assertEqual(result["assessments"][0]["status"], "failed")

    def test_worker_imports_receipt_without_current_directory_or_pythonpath(self):
        with patch.object(bridge.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "{}", "")) as mock:
            bridge.run_worker(Path("/trusted/venv/bin/python"), self.spec, self.root, self.binding["specSha256"], None, 10)
        command = mock.call_args.args[0]
        self.assertEqual(command[:2], ["/trusted/venv/bin/python", "-I"])
        self.assertEqual(command[-1], "--_worker")
        self.assertNotIn("shell", mock.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
