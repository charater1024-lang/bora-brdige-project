#!/usr/bin/env python3
"""Private online SQLite backup, isolated restore drill, optional public-key envelope.

Never modifies/restores the source database and never uploads anything. All
stdout/status errors are fixed codes, not SQL values, credentials or raw errors.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import struct
import tempfile
import time
from datetime import datetime, timezone
import uuid

MAGIC = b"BORAENC1\n"
ALGORITHM = "RSA-OAEP-SHA256+AES-256-GCM"
NAME = re.compile(r"bora-db-\d{8}T\d{6}Z-[0-9a-f]{12}\.(?:boraenc|sqlite)$")
CHUNK = 1024 * 1024


class BackupError(Exception):
    pass


def safe_path(value: Path, *, exists: bool = True) -> Path:
    absolute = Path(os.path.abspath(value))
    if any(parent.is_symlink() for parent in (absolute, *absolute.parents)):
        raise BackupError("symlink_path_refused")
    if exists and not absolute.exists():
        raise BackupError("required_path_missing")
    return absolute


def private_directory(path: Path) -> Path:
    path = safe_path(path, exists=False)
    if len(path.parts) < 3:
        raise BackupError("broad_backup_path_refused")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode):
        raise BackupError("backup_directory_required")
    if os.name == "posix" and (info.st_mode & 0o077 or info.st_uid != os.getuid()):
        raise BackupError("backup_directory_not_private")
    return path


def exclusive_file(path: Path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    return os.fdopen(descriptor, "wb")


def private_json(path: Path, value: dict, *, replace: bool = False) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with exclusive_file(temporary) as output:
            output.write((json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode())
            output.flush()
            os.fsync(output.fileno())
        if replace:
            if path.is_symlink():
                raise BackupError("status_symlink_refused")
            os.replace(temporary, path)
        else:
            os.link(temporary, path)  # Atomic publish with no overwrite.
    finally:
        temporary.unlink(missing_ok=True)


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def connect_readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)


def deadline_check(deadline: float) -> None:
    if time.monotonic() > deadline:
        raise BackupError("backup_deadline_exceeded")


def online_copy(source: Path, destination: Path, deadline: float) -> None:
    with exclusive_file(destination):
        pass
    with closing(connect_readonly(source)) as reader, closing(sqlite3.connect(destination)) as writer:
        reader.backup(writer, pages=128, sleep=0.05,
                      progress=lambda *_: deadline_check(deadline))
    with destination.open("r+b") as stream:
        os.fsync(stream.fileno())


def validate_database(path: Path, deadline: float) -> int:
    with closing(connect_readonly(path)) as database:
        database.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
        if database.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise BackupError("database_integrity_failed")
        if database.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise BackupError("database_foreign_key_failed")
        count = database.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
        if count < 1:
            raise BackupError("database_has_no_tables")
        return int(count)


def encrypt_snapshot(source: Path, destination: Path, public_key_path: Path, deadline: float) -> dict:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    public_bytes = safe_path(public_key_path).read_bytes()
    public_key = serialization.load_pem_public_key(public_bytes)
    if not isinstance(public_key, rsa.RSAPublicKey) or public_key.key_size < 3072:
        raise BackupError("rsa_public_key_must_be_at_least_3072_bits")
    key, nonce = os.urandom(32), os.urandom(12)
    wrapped = public_key.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    header = json.dumps({
        "algorithm": ALGORITHM,
        "wrapped_key": base64.b64encode(wrapped).decode(),
        "nonce": base64.b64encode(nonce).decode(),
        "plaintext_size": source.stat().st_size,
    }, sort_keys=True, separators=(",", ":")).encode()
    aad = MAGIC + struct.pack(">I", len(header)) + header
    cipher = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    cipher.authenticate_additional_data(aad)
    source_hash = hashlib.sha256()
    with source.open("rb") as stream, exclusive_file(destination) as output:
        output.write(aad)
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            deadline_check(deadline)
            source_hash.update(chunk)
            output.write(cipher.update(chunk))
        output.write(cipher.finalize())
        output.write(cipher.tag)
        output.flush()
        os.fsync(output.fileno())

    # Verify the saved authenticated ciphertext using the ephemeral key, without
    # putting the private key or another plaintext copy on this server.
    with destination.open("rb") as encrypted:
        if encrypted.read(len(aad)) != aad:
            raise BackupError("envelope_header_verification_failed")
        encrypted.seek(-16, 2)
        tag = encrypted.read(16)
        encrypted.seek(len(aad))
        remaining = destination.stat().st_size - len(aad) - 16
        decrypted_hash = hashlib.sha256()
        verify = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        verify.authenticate_additional_data(aad)
        while remaining:
            deadline_check(deadline)
            chunk = encrypted.read(min(CHUNK, remaining))
            if not chunk:
                raise BackupError("envelope_truncated")
            remaining -= len(chunk)
            decrypted_hash.update(verify.update(chunk))
        decrypted_hash.update(verify.finalize())
        if decrypted_hash.digest() != source_hash.digest():
            raise BackupError("envelope_plaintext_hash_mismatch")
    fingerprint = hashlib.sha256(public_key.public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
    return {"algorithm": ALGORITHM, "public_key_sha256": fingerprint,
            "plaintext_sha256": source_hash.hexdigest(), "encryption_verified": True}


def retain_backups(directory: Path, retain: int) -> None:
    candidates = []
    for path in directory.iterdir():
        if not NAME.fullmatch(path.name) or path.is_symlink() or not path.is_file():
            continue
        metadata = path.with_suffix(path.suffix + ".json")
        if metadata.is_symlink() or not metadata.is_file():
            continue
        try:
            value = json.loads(metadata.read_text())
            if value.get("kind") == "bora-sqlite-backup-v1" and value.get("file") == path.name and value.get("restore_verified") is True:
                candidates.append(path)
        except (ValueError, OSError):
            continue
    # Only verified backups created by this tool are eligible; unknown files,
    # symlinks and partial results are never deletion targets.
    for path in sorted(candidates, key=lambda item: item.name, reverse=True)[retain:]:
        if path.is_symlink() or path.with_suffix(path.suffix + ".json").is_symlink():
            raise BackupError("retention_target_changed")
        path.unlink()
        path.with_suffix(path.suffix + ".json").unlink()


def run_backup(database: Path, backup_dir: Path, *, public_key: Path | None = None, retain: int = 14,
               timeout: float = 900) -> dict:
    if retain < 2 or retain > 365 or timeout < 1:
        raise BackupError("invalid_backup_policy")
    directory = private_directory(backup_dir)
    status_path = directory / "latest-status.json"
    started = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lock = None
    phase = "preflight"
    try:
        if public_key:
            try:
                import cryptography  # noqa: F401: fail before expensive SQLite copies
            except ImportError:
                raise BackupError("encryption_dependency_unavailable") from None
        source = safe_path(database)
        if not source.is_file() or source.parent == directory or directory in source.parents:
            raise BackupError("source_database_path_refused")
        if os.name == "posix":
            import fcntl
            descriptor = os.open(directory / ".backup.lock", os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
            lock = os.fdopen(descriptor, "wb")
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise BackupError("backup_already_running") from error
        deadline = time.monotonic() + timeout
        # Account for a large live WAL as well as the base DB. Leave room for
        # snapshot + isolated restored DB + ciphertext without filling the host.
        wal = source.with_name(source.name + "-wal")
        source_bytes = source.stat().st_size
        if wal.exists():
            source_bytes += safe_path(wal).stat().st_size
        if shutil.disk_usage(directory).free < source_bytes * 4 + 64 * CHUNK:
            raise BackupError("insufficient_backup_space")
        filename = f"bora-db-{started}-{uuid.uuid4().hex[:12]}" + (".boraenc" if public_key else ".sqlite")
        with tempfile.TemporaryDirectory(prefix=".bora-backup-", dir=directory) as temporary:
            work = Path(temporary)
            snapshot, restored = work / "snapshot.sqlite", work / "restore-check.sqlite"
            phase = "snapshot"
            online_copy(source, snapshot, deadline)
            phase = "snapshot_integrity"
            table_count = validate_database(snapshot, deadline)
            phase = "restore_copy"
            online_copy(snapshot, restored, deadline)
            phase = "restore_integrity"
            if validate_database(restored, deadline) != table_count:
                raise BackupError("isolated_restore_failed")
            artifact = work / filename
            metadata = {"kind": "bora-sqlite-backup-v1", "file": filename, "created_at": started,
                        "integrity": "ok", "restore_verified": True, "table_count": table_count,
                        "plaintext_size": snapshot.stat().st_size, "encrypted": public_key is not None}
            if public_key:
                phase = "encryption"
                metadata.update(encrypt_snapshot(snapshot, artifact, public_key, deadline))
            else:
                phase = "plaintext_publish_prepare"
                os.link(snapshot, artifact)
                metadata["plaintext_sha256"] = hash_file(snapshot)
            phase = "publish"
            metadata.update({"sha256": hash_file(artifact), "size": artifact.stat().st_size})
            os.link(artifact, directory / filename)
            private_json(directory / (filename + ".json"), metadata)
        phase = "retention"
        retain_backups(directory, retain)
        result = {"status": "ok", "checked_at": started, "file": filename, "sha256": metadata["sha256"],
                  "restore_verified": True, "encrypted": public_key is not None,
                  "offsite_copy_verified": False}
        phase = "status"
        private_json(status_path, result, replace=True)
        return result
    except Exception as error:
        code = str(error) if isinstance(error, BackupError) else f"backup_failed_{phase}"
        private_json(status_path, {"status": "failed", "checked_at": started, "code": code,
                                  "phase": phase, "error_type": type(error).__name__}, replace=True)
        raise BackupError(code) from None
    finally:
        if lock:
            lock.close()


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=os.environ.get("BORA_DATABASE_PATH"))
    parser.add_argument("--backup-dir", type=Path, default=os.environ.get("BORA_BACKUP_DIR"))
    parser.add_argument("--public-key", type=Path, default=os.environ.get("BORA_BACKUP_PUBLIC_KEY"))
    parser.add_argument("--retain", type=int, default=14)
    parser.add_argument("--timeout", type=float, default=900)
    args = parser.parse_args()
    try:
        if args.database is None or args.backup_dir is None:
            raise BackupError("backup_paths_not_configured")
        result = run_backup(args.database, args.backup_dir, public_key=args.public_key,
                            retain=args.retain, timeout=args.timeout)
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except BackupError as error:
        print(json.dumps({"status": "failed", "code": str(error)}, separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
