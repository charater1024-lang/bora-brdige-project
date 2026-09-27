#!/usr/bin/env python3
"""Windows-only encrypted offsite backup client; never sends a private key.

Requires Python cryptography. DPAPI binds the key to this Windows user/machine.
Losing this Windows profile/key also loses access to these backups. This is an
off-server copy, not a substitute for a separately secured key recovery plan.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import closing
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import time

MAGIC = b"BORAENC1\n"
ALGORITHM = "RSA-OAEP-SHA256+AES-256-GCM"
NAME = re.compile(r"bora-db-\d{8}T\d{6}Z-[0-9a-f]{12}\.boraenc$")
CHUNK = 1024 * 1024
MAX_BYTES = 20 * 1024**3


class ClientError(Exception):
    pass


def secure_directory(path: Path) -> Path:
    if os.name != "nt":
        raise ClientError("windows_required")
    path = Path(os.path.abspath(path))
    if len(path.parts) < 4 or any(p.is_symlink() or p.is_junction() for p in (path, *path.parents)):
        raise ClientError("unsafe_backup_directory")
    path.mkdir(parents=True, exist_ok=True)
    # Explicit current-user + SYSTEM only. Never use /T against a user folder.
    sid = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                          "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"],
                         capture_output=True, text=True, check=True, timeout=20).stdout.strip()
    if not re.fullmatch(r"S-1-5-21-(?:\d+-){3}\d+", sid):
        raise ClientError("windows_user_sid_unavailable")
    subprocess.run(["icacls.exe", str(path), "/inheritance:r", "/grant:r",
                    f"*{sid}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F"],
                   capture_output=True, check=True, timeout=20)
    return path


def dpapi(value: bytes, *, decrypt: bool = False) -> bytes:
    if os.name != "nt":
        raise ClientError("windows_required")
    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]
    source = ctypes.create_string_buffer(value)
    incoming = Blob(len(value), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    function = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                         ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise ClientError("windows_key_protection_failed")
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        ctypes.memset(outgoing.data, 0, outgoing.size)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        kernel32.LocalFree(outgoing.data)


def fingerprint(public_key) -> str:
    from cryptography.hazmat.primitives import serialization
    return hashlib.sha256(public_key.public_bytes(serialization.Encoding.DER,
                          serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()


def initialize(directory: Path) -> dict:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    directory = secure_directory(directory)
    private_path, public_path = directory / "recovery-key.dpapi", directory / "backup-public.pem"
    if private_path.exists() or public_path.exists():
        raise ClientError("key_already_exists")
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    private = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
    protected = dpapi(private)
    # Round trip before persisting. Raw private bytes are never a filesystem file.
    recovered = serialization.load_der_private_key(dpapi(protected, decrypt=True), password=None)
    if fingerprint(recovered.public_key()) != fingerprint(key.public_key()):
        raise ClientError("key_roundtrip_failed")
    with private_path.open("xb") as out:
        out.write(protected)
    with public_path.open("xb") as out:
        out.write(key.public_key().public_bytes(serialization.Encoding.PEM,
                  serialization.PublicFormat.SubjectPublicKeyInfo))
    return {"status": "ok", "key_protection": "Windows CurrentUser DPAPI",
            "public_key_sha256": fingerprint(key.public_key())}


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_envelope(artifact: Path, metadata: dict, key, work_directory: Path) -> dict:
    """Authenticated decryption + real SQLite restore drill in a private tempdir."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    size = artifact.stat().st_size
    if not 16 < size <= MAX_BYTES or size != metadata.get("size") or hash_file(artifact) != metadata.get("sha256"):
        raise ClientError("encrypted_file_integrity_failed")
    if metadata.get("public_key_sha256") != fingerprint(key.public_key()):
        raise ClientError("wrong_recovery_key")
    with artifact.open("rb") as stream:
        prefix = stream.read(len(MAGIC) + 4)
        if prefix[:len(MAGIC)] != MAGIC:
            raise ClientError("invalid_backup_format")
        length = struct.unpack(">I", prefix[-4:])[0]
        if not 1 <= length <= 8192:
            raise ClientError("invalid_header_length")
        raw_header = stream.read(length)
        header = json.loads(raw_header)
        if header.get("algorithm") != ALGORITHM:
            raise ClientError("unsupported_encryption")
        nonce = base64.b64decode(header["nonce"], validate=True)
        wrapped = base64.b64decode(header["wrapped_key"], validate=True)
        if len(nonce) != 12 or len(wrapped) != key.key_size // 8:
            raise ClientError("invalid_encryption_parameters")
        remaining = size - len(prefix) - length - 16
        if remaining < 0 or remaining != header.get("plaintext_size") or remaining != metadata.get("plaintext_size"):
            raise ClientError("plaintext_size_mismatch")
        aes = key.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        if len(aes) != 32:
            raise ClientError("invalid_key_size")
        stream.seek(-16, 2)
        tag = stream.read(16)
        stream.seek(len(prefix) + length)
        decryptor = Cipher(algorithms.AES(aes), modes.GCM(nonce, tag)).decryptor()
        decryptor.authenticate_additional_data(prefix + raw_header)
        digest = hashlib.sha256()
        # Never open unauthenticated plaintext with SQLite before GCM finalizes.
        with tempfile.TemporaryDirectory(prefix=".restore-check-", dir=work_directory) as temporary:
            restored = Path(temporary) / "restore.sqlite"
            with restored.open("xb") as output:
                while remaining:
                    chunk = stream.read(min(CHUNK, remaining))
                    if not chunk:
                        raise ClientError("truncated_ciphertext")
                    remaining -= len(chunk)
                    clear = decryptor.update(chunk)
                    digest.update(clear)
                    output.write(clear)
                final = decryptor.finalize()
                digest.update(final)
                output.write(final)
            if digest.hexdigest() != metadata.get("plaintext_sha256"):
                raise ClientError("plaintext_hash_mismatch")
            with closing(sqlite3.connect(restored.as_uri() + "?mode=ro", uri=True)) as database:
                if database.execute("PRAGMA quick_check").fetchall() != [("ok",)] or database.execute("PRAGMA foreign_key_check").fetchone() is not None:
                    raise ClientError("restored_database_integrity_failed")
                tables = database.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
                if tables != metadata.get("table_count") or tables < 1:
                    raise ClientError("restored_database_schema_mismatch")
    return {"status": "ok", "encrypted": True, "decryption_verified": True,
            "restore_verified": True, "plaintext_removed": True, "table_count": tables}


def read_remote(host: str, directory: str, name: str) -> dict:
    path = directory + "/" + name
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host,
                             "cat -- " + shlex.quote(path)], capture_output=True, timeout=25)
    if result.returncode or len(result.stdout) > 16384:
        raise ClientError("remote_metadata_unavailable")
    return json.loads(result.stdout)


def sync(directory: Path, config_path: Path) -> dict:
    from cryptography.hazmat.primitives import serialization
    directory = secure_directory(directory)
    config = json.loads(config_path.read_text(encoding="utf-8-sig"))
    host, remote = config["ssh_host"], config["remote_directory"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+", host) or not re.fullmatch(r"/[A-Za-z0-9_/.-]+", remote) or ".." in remote.split("/"):
        raise ClientError("invalid_remote_configuration")
    status = read_remote(host, remote, "latest-status.json")
    name = status.get("file", "")
    if status.get("status") != "ok" or not NAME.fullmatch(name):
        raise ClientError("no_verified_remote_backup")
    metadata = read_remote(host, remote, name + ".json")
    if metadata.get("kind") != "bora-sqlite-backup-v1" or metadata.get("file") != name or metadata.get("encrypted") is not True or metadata.get("restore_verified") is not True or status.get("sha256") != metadata.get("sha256"):
        raise ClientError("invalid_backup_metadata")
    size = metadata.get("size")
    if not isinstance(size, int) or isinstance(size, bool) or not 16 < size <= MAX_BYTES:
        raise ClientError("invalid_backup_size")
    if shutil.disk_usage(directory).free < size * 2 + 64 * CHUNK:
        raise ClientError("insufficient_local_backup_space")
    key = serialization.load_der_private_key(dpapi((directory / "recovery-key.dpapi").read_bytes(), decrypt=True), password=None)
    artifact = directory / name
    if artifact.is_symlink():
        raise ClientError("unsafe_artifact_path")
    if not artifact.exists():
        # Interrupted transfers do not permanently block the next scheduled
        # attempt. Each download gets its own private, recoverably disposable
        # temp directory; no existing backup is replaced.
        with tempfile.TemporaryDirectory(prefix=".download-", dir=directory) as temporary_directory:
            temporary = Path(temporary_directory) / name
            result = subprocess.run(["scp", "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                                     host + ":" + remote + "/" + name, str(temporary)], capture_output=True, timeout=900)
            if result.returncode:
                raise ClientError("encrypted_backup_download_failed")
            if temporary.stat().st_size != size or hash_file(temporary) != metadata.get("sha256"):
                raise ClientError("download_hash_mismatch")
            temporary.rename(artifact)
    result = verify_envelope(artifact, metadata, key, directory)
    result.update({"file": name, "checked_at": int(time.time()), "offsite_copy_verified": True})
    (directory / (name + ".json")).write_text(json.dumps(metadata, sort_keys=True), encoding="utf-8")
    (directory / "last-sync.json").write_text(json.dumps(result, sort_keys=True), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("init", "sync"))
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "sync" and args.config is None:
            raise ClientError("configuration_required")
        result = initialize(args.directory) if args.command == "init" else sync(args.directory, args.config)
        print(json.dumps(result))
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "code": str(error) if isinstance(error, ClientError) else "backup_client_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
