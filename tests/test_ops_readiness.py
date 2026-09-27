from __future__ import annotations

from contextlib import closing
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bora_readiness_test", ROOT / "deploy/check-bora-deep-readiness.py")
readiness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readiness)


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="bora-readiness-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source.sqlite"
        connection = sqlite3.connect(self.source)
        connection.executescript("CREATE TABLE auth_sessions(id); CREATE TABLE oauth_users(id); CREATE TABLE user_finance_snapshots(id);")
        connection.execute("""CREATE TABLE public_api_source_state(
            source_id TEXT PRIMARY KEY, consecutive_failures INTEGER, last_success_at INTEGER,
            last_attempt_at INTEGER, next_due_at INTEGER, last_error TEXT)""")
        now = int(time.time() * 1000)
        connection.execute("INSERT INTO public_api_source_state VALUES(?,0,?,?,?,NULL)",
                           ("bizinfo", now, now, now + 3_600_000))
        connection.commit()
        connection.close()
        self.backups = self.root / "backups"
        readiness.helpers.run_backup(self.source, self.backups)

    def test_success_is_explicit_about_unverified_login_write_and_offsite_paths(self):
        with patch.object(readiness, "json_get", side_effect=self.healthy_probe):
            result = readiness.observe(self.source, self.backups, public_url="https://example.invalid")
        self.assertEqual(result["status"], "ok")
        for key in ("inference_tested", "oauth_login_tested", "asset_write_tested", "offsite_copy_verified", "automatic_restart"):
            self.assertFalse(result[key])

    def test_cold_model_is_a_warning_and_not_a_web_restart_failure(self):
        with patch.object(readiness, "json_get", side_effect=lambda url, **kwargs:
                          {"status": "ok", "ready": False} if "11435" in url else {"status": "ok"}):
            result = readiness.observe(self.source, self.backups, public_url="https://example.invalid")
        self.assertEqual(result["status"], "warning")
        self.assertEqual(result["checks"]["llm_resident"], "cold_or_loading")
        self.assertFalse(result["automatic_restart"])

    @staticmethod
    def healthy_probe(url, **_kwargs):
        return {"status": "ok", "ready": True} if "11435" in url else {"status": "ok"}

    def test_repeated_collection_failure_is_a_redacted_warning_not_restart(self):
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("UPDATE public_api_source_state SET consecutive_failures=92, last_error=?",
                               ("https://provider.invalid?key=test-synthetic-secret",))
        with patch.object(readiness, "json_get", side_effect=self.healthy_probe):
            result = readiness.observe(self.source, self.backups, public_url="https://example.invalid")
        self.assertEqual(result["status"], "warning")
        self.assertEqual(result["checks"]["web"], "ok")
        self.assertEqual(result["public_collection"]["persistent_failure_count"], 1)
        self.assertEqual(result["public_collection"]["sources"][0]["code"], "repeated_failure")
        self.assertNotIn("synthetic-secret", json.dumps(result))
        self.assertNotIn("provider.invalid", json.dumps(result))
        self.assertFalse(result["automatic_restart"])

    def test_inactive_state_is_not_counted_as_active_failure_and_unknown_ids_are_redacted(self):
        now = int(time.time() * 1000)
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("UPDATE public_api_source_state SET consecutive_failures=92, last_success_at=NULL, last_error='disabled_by_operator'")
        result = readiness.collection_health(self.source)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["disabled_count"], 1)
        self.assertEqual(result["persistent_failure_count"], 0)
        self.assertEqual(result["activation_basis"], "last_recorded_source_state")
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("INSERT INTO public_api_source_state VALUES(?,0,?,?,?,NULL)",
                               ("synthetic-secret-source", now, now, now + 3_600_000))
        result = readiness.collection_health(self.source)
        self.assertEqual(result["status"], "warning")
        self.assertEqual(result["unknown_source_count"], 1)
        self.assertNotIn("synthetic-secret", json.dumps(result))

    def test_overdue_or_missing_collection_state_is_not_healthy(self):
        now = int(time.time() * 1000)
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("UPDATE public_api_source_state SET next_due_at=?", (now - 3_600_001,))
        self.assertEqual(readiness.collection_health(self.source, now_ms=now)["overdue_count"], 1)
        with closing(sqlite3.connect(self.source)) as connection, connection:
            connection.execute("DROP TABLE public_api_source_state")
        with patch.object(readiness, "json_get", side_effect=self.healthy_probe):
            result = readiness.observe(self.source, self.backups, public_url="https://example.invalid")
        self.assertEqual(result["public_collection"]["code"], "collection_state_unavailable")
        self.assertEqual(result["status"], "warning")

    def test_network_reason_codes_require_actual_block_evidence_and_never_log_errors(self):
        cases = (
            (TimeoutError("synthetic-secret"), "timeout"),
            (urllib.error.URLError(TimeoutError("synthetic-secret")), "timeout"),
            (urllib.error.HTTPError("https://secret.invalid", 403, "secret", {"server": "cloudflare"}, None), "cf_blocked"),
            (urllib.error.HTTPError("https://secret.invalid", 403, "secret", {}, None), "blocked"),
            (urllib.error.HTTPError("https://secret.invalid", 503, "secret", {}, None), "unavailable"),
            (RuntimeError("synthetic-secret"), "unavailable"),
        )
        for error, expected in cases:
            with self.subTest(expected=expected), patch.object(readiness, "json_get", side_effect=error):
                result = readiness.observe(self.source, self.backups, public_url="https://example.invalid")
            self.assertEqual(result["checks"]["public_domain"], "failed")
            self.assertEqual(result["check_codes"]["public_domain"], expected)
            self.assertNotIn("secret", json.dumps(result))

    def test_public_health_requires_exact_minimal_json(self):
        with patch.object(readiness, "json_get", return_value={"status": "ok", "ready": True}):
            result = readiness.observe(self.source, self.backups, public_url="https://example.invalid")
        self.assertEqual(result["checks"]["public_domain"], "failed")
        self.assertEqual(result["check_codes"]["public_domain"], "invalid_response")

    def test_missing_database_failed_backup_or_network_failure_is_not_healthy(self):
        with patch.object(readiness, "json_get", side_effect=RuntimeError("synthetic-secret-url")):
            result = readiness.observe(self.root / "missing.sqlite", self.backups, public_url="https://example.invalid")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["checks"]["database_read"], "failed")
        self.assertEqual(result["checks"]["public_domain"], "failed")
        self.assertNotIn("synthetic-secret-url", json.dumps(result))
        status = self.backups / "latest-status.json"
        value = json.loads(status.read_text())
        value["status"] = "failed"
        status.write_text(json.dumps(value))
        self.assertFalse(readiness.backup_ready(self.backups, 30))

    def test_stale_or_future_backup_status_is_rejected(self):
        status = self.backups / "latest-status.json"
        value = json.loads(status.read_text())
        for date in ("20000101T000000Z", "29990101T000000Z"):
            value["checked_at"] = date
            status.write_text(json.dumps(value))
            self.assertFalse(readiness.backup_ready(self.backups, 30))

    def test_probe_rejects_cleartext_external_urls_and_credentials(self):
        for url in ("http://example.invalid/health", "https://user:test-only-secret@example.invalid/health", "https://example.invalid/health?key=test-only-secret"):
            with self.assertRaises(ValueError):
                readiness.json_get(url)

    def test_loopback_web_probe_uses_canonical_origin_without_credentials(self):
        class Response(io.BytesIO):
            status = 200
        response = Response(b'{"status":"ok"}')
        with patch.object(readiness.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = response
            self.assertEqual(readiness.json_get("http://127.0.0.1:3000/api/health", "https://example.invalid"), {"status": "ok"})
            request = factory.return_value.open.call_args.args[0]
        headers = {name.lower(): value for name, value in request.header_items()}
        self.assertEqual(headers["host"], "example.invalid")
        self.assertEqual(headers["origin"], "https://example.invalid")
        self.assertEqual(headers["x-forwarded-host"], "example.invalid")
        self.assertEqual(headers["x-forwarded-proto"], "https")
        self.assertNotIn("authorization", headers)

    def test_observation_units_are_not_bound_to_web_recovery(self):
        for name in ("bora-deep-readiness.service", "bora-database-backup.service"):
            source = (ROOT / "deploy" / name).read_text()
            self.assertNotIn("OnFailure=bora-bridge-recover", source)
            self.assertNotIn("Restart=", source)
            self.assertIn("UMask=0077", source)


if __name__ == "__main__":
    unittest.main()
