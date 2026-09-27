#!/usr/bin/env python3
"""Bounded, non-mutating dependency observations; never a web restart trigger."""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

SPEC = importlib.util.spec_from_file_location("bora_ops_backup", Path(__file__).with_name("backup-bora-sqlite.py"))
helpers = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helpers)

# Identifiers only, never provider credentials or saved provider error text.
SOURCE_IDS = frozenset((
    "exchange", "stock", "financial-company", "loan-product", "commercial-area",
    "seoul-commercial", "kosaf-high", "kosaf-university", "ecos", "finlife", "dart",
    "bizinfo", "bizinfo-data-go", "kstartup", "work24", "youth-center",
    "kosis-employment", "moel-policy-news", "moel-press-releases",
))
PROBE_CODES = frozenset(("timeout", "blocked", "cf_blocked", "unavailable",
                        "invalid_response", "response_too_large"))


class ProbeError(Exception):
    def __init__(self, code: str):
        self.code = code if code in PROBE_CODES else "unavailable"
        super().__init__(self.code)


def probe_error_code(error: Exception) -> str:
    if isinstance(error, ProbeError):
        return error.code
    if isinstance(error, (TimeoutError,)):
        return "timeout"
    if isinstance(error, urllib.error.HTTPError):
        if error.code == 403:
            headers = error.headers or {}
            cloudflare = bool(headers.get("cf-ray")) or str(headers.get("server", "")).lower() == "cloudflare"
            return "cf_blocked" if cloudflare else "blocked"
        return "unavailable"
    if isinstance(error, urllib.error.URLError) and isinstance(error.reason, TimeoutError):
        return "timeout"
    return "unavailable"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def json_get(url: str, public_origin: str | None = None) -> dict:
    parsed = urlparse(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("invalid_probe_url")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1", "localhost")):
        raise ValueError("probe_requires_https_or_loopback")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    headers = {"Accept": "application/json", "User-Agent": "BORA-private-readiness/1"}
    if public_origin and parsed.hostname in ("127.0.0.1", "::1", "localhost"):
        origin = urlparse(public_origin)
        if origin.scheme != "https" or not origin.netloc or origin.username or origin.password or origin.query or origin.fragment or origin.path not in ("", "/"):
            raise ValueError("invalid_public_probe_origin")
        # Match the existing loopback web health check's canonical-origin
        # headers; without them configured OAuth redirects appear unavailable.
        headers.update({"Host": origin.netloc, "X-Forwarded-Host": origin.netloc,
                        "X-Forwarded-Proto": "https", "Origin": public_origin.rstrip("/")})
    request = urllib.request.Request(url, headers=headers)
    deadline = time.monotonic() + 4
    with opener.open(request, timeout=4) as response:
        if response.status != 200:
            raise ProbeError("unavailable")
        body = bytearray()
        while True:
            if time.monotonic() > deadline:
                raise ProbeError("timeout")
            chunk = response.read1(4096)
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > 65536:
                raise ProbeError("response_too_large")
        try:
            value = json.loads(body)
        except (ValueError, UnicodeError) as error:
            raise ProbeError("invalid_response") from error
        if not isinstance(value, dict):
            raise ProbeError("invalid_response")
        return value


def database_ready(path: Path) -> bool:
    path = helpers.safe_path(path)
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)) as database:
        deadline = time.monotonic() + 2
        database.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        # Actual read queries, never profile values, encrypted payloads or writes.
        for table in ("auth_sessions", "oauth_users", "user_finance_snapshots"):
            database.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
    return True


def collection_health(path: Path, *, now_ms: int | None = None) -> dict:
    """Observe last-recorded collection state, not runtime credential activation.

    Query only bounded operational facts and derive inactive markers in SQL.
    Raw last_error/credential/user columns are never returned or logged.
    """
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    path = helpers.safe_path(path)
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)) as database:
        deadline = time.monotonic() + 2
        database.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        rows = database.execute("""SELECT source_id, consecutive_failures,
            last_success_at, last_attempt_at, next_due_at,
            CASE WHEN last_error IN ('credential-unavailable', 'disabled_by_operator')
                THEN 1 ELSE 0 END AS inactive
            FROM public_api_source_state ORDER BY source_id LIMIT 129""").fetchall()
    sources = []
    counts = {"disabled_count": 0, "failing_count": 0, "persistent_failure_count": 0,
              "overdue_count": 0, "never_succeeded_count": 0, "unknown_source_count": 0}
    for source_id, failures, success, _attempt, next_due, inactive in rows[:128]:
        if source_id not in SOURCE_IDS:
            counts["unknown_source_count"] += 1
            continue
        failures = min(max(int(failures or 0), 0), 2_147_483_647)
        valid_success = isinstance(success, int) and 0 < success <= now_ms
        overdue = isinstance(next_due, int) and 0 < next_due < now_ms - 3_600_000
        if inactive:
            code = "inactive"
            counts["disabled_count"] += 1
        else:
            counts["failing_count"] += int(failures > 0)
            counts["persistent_failure_count"] += int(failures >= 3)
            counts["overdue_count"] += int(overdue)
            counts["never_succeeded_count"] += int(not valid_success)
            code = ("repeated_failure" if failures >= 3 else "collection_failure" if failures
                    else "collection_overdue" if overdue else "not_collected" if not valid_success
                    else "current")
        sources.append({"source_id": source_id, "code": code, "consecutive_failures": failures,
                        "last_success_age_hours": round((now_ms - success) / 3_600_000, 2) if valid_success else None})
    warning = (not rows or len(rows) > 128 or any(counts[name] > 0 for name in
               ("failing_count", "overdue_count", "never_succeeded_count", "unknown_source_count")))
    return {"status": "warning" if warning else "ok", "code": "collection_attention" if warning else "collection_current",
            "source_count": len(rows[:128]), **counts, "truncated": len(rows) > 128,
            "activation_basis": "last_recorded_source_state", "sources": sources}


def backup_ready(directory: Path, max_age_hours: float) -> bool:
    directory = helpers.safe_path(directory)
    status = json.loads(helpers.safe_path(directory / "latest-status.json").read_text())
    filename = status.get("file", "")
    if not helpers.NAME.fullmatch(filename):
        return False
    checked = datetime.strptime(status["checked_at"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - checked).total_seconds()
    return (status.get("status") == "ok" and status.get("restore_verified") is True
            and 0 <= age <= max_age_hours * 3600
            and helpers.safe_path(directory / filename).is_file())


def observe(database: Path, backup_dir: Path, *, public_url: str | None = None,
            web_url: str = "http://127.0.0.1:3000/api/health",
            gateway_url: str = "http://127.0.0.1:11435/health", backup_max_age_hours: float = 30) -> dict:
    checks = {}
    check_codes = {}
    for name, operation in (
        ("web", lambda: json_get(web_url, public_origin=public_url).get("status") == "ok"),
        ("database_read", lambda: database_ready(database)),
        ("verified_backup_recent", lambda: backup_ready(backup_dir, backup_max_age_hours)),
    ):
        try:
            checks[name] = "ok" if operation() else "failed"
        except Exception as error:
            checks[name] = "failed"
            check_codes[name] = probe_error_code(error) if name == "web" else "read_unavailable"
    try:
        collection = collection_health(database)
        checks["public_collection"] = collection["status"]
    except Exception:
        collection = {"status": "warning", "code": "collection_state_unavailable"}
        checks["public_collection"] = "warning"
    try:
        gateway = json_get(gateway_url)
        checks["llm_gateway"] = "ok" if gateway.get("status") == "ok" else "failed"
        checks["llm_resident"] = "ok" if gateway.get("ready") is True else "cold_or_loading"
    except Exception as error:
        checks["llm_gateway"] = "failed"
        checks["llm_resident"] = "unknown"
        check_codes["llm_gateway"] = probe_error_code(error)
    if public_url:
        try:
            # Anonymous health has a deliberately minimal, exact response.
            checks["public_domain"] = "ok" if json_get(public_url.rstrip("/") + "/api/health") == {"status": "ok"} else "failed"
            if checks["public_domain"] != "ok":
                check_codes["public_domain"] = "invalid_response"
        except Exception as error:
            checks["public_domain"] = "failed"
            check_codes["public_domain"] = probe_error_code(error)
    else:
        checks["public_domain"] = "not_configured"
    overall = "failed" if "failed" in checks.values() else "ok" if all(item == "ok" for item in checks.values()) else "warning"
    return {"event": "bora_deep_readiness", "status": overall,
            "checked_at": datetime.now(timezone.utc).isoformat(), "checks": checks,
            "check_codes": check_codes, "public_collection": collection,
            "inference_tested": False, "oauth_login_tested": False, "asset_write_tested": False,
            "offsite_copy_verified": False, "automatic_restart": False}


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=os.environ.get("BORA_DATABASE_PATH"))
    parser.add_argument("--backup-dir", type=Path, default=os.environ.get("BORA_BACKUP_DIR"))
    parser.add_argument("--status-dir", type=Path, default=os.environ.get("BORA_OPS_STATUS_DIR"))
    parser.add_argument("--public-url", default=os.environ.get("BORA_PUBLIC_URL"))
    args = parser.parse_args()
    if args.database is None or args.backup_dir is None or args.status_dir is None:
        print('{"event":"bora_deep_readiness","status":"failed","code":"ops_paths_not_configured"}')
        return 1
    try:
        result = observe(args.database, args.backup_dir, public_url=args.public_url)
        directory = helpers.private_directory(args.status_dir)
        helpers.private_json(directory / "deep-readiness.json", result, replace=True)
        print(json.dumps(result, separators=(",", ":")))
        return int(result["status"] == "failed")
    except Exception:
        print('{"event":"bora_deep_readiness","status":"failed","code":"ops_status_write_failed"}')
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
