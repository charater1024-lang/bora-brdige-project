"""Synthetic SQLite only: no production paths, uploads or service actions."""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bora_backup_test", ROOT / "deploy/backup-bora-sqlite.py")
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="bora-backup-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source.sqlite"
        database = sqlite3.connect(self.source)
        database.executescript("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO records VALUES (1,'synthetic-private-data');")
        database.commit()
        database.close()
        self.before = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.output = self.root / "private-backups"

    def tearDown(self):
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.before)
        if self.output.exists():
            self.assertEqual(list(self.output.glob(".bora-backup-*")), [])

    def test_online_backup_restore_validation_and_private_permissions(self):
        result = backup.run_backup(self.source, self.output)
        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["restore_verified"])
        self.assertFalse(result["offsite_copy_verified"])
        restored = sqlite3.connect(self.output / result["file"])
        self.assertEqual(restored.execute("SELECT value FROM records").fetchone()[0], "synthetic-private-data")
        restored.close()
        metadata = json.loads((self.output / (result["file"] + ".json")).read_text())
        self.assertEqual(metadata["integrity"], "ok")
        self.assertNotIn("synthetic-private-data", json.dumps(metadata))
        if os.name == "posix":
            self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.output / result["file"]).stat().st_mode & 0o777, 0o600)

    def test_retention_removes_only_verified_tool_owned_backups(self):
        self.output.mkdir(mode=0o700)
        unrelated = self.output / "other.sqlite"
        unrelated.write_text("do not remove")
        partial = self.output / "bora-db-20000101T000000Z-000000000000.sqlite"
        partial.write_text("unverified do not remove")
        for _ in range(3):
            backup.run_backup(self.source, self.output, retain=2)
        self.assertTrue(unrelated.exists())
        self.assertTrue(partial.exists())
        self.assertEqual(len(list(self.output.glob("bora-db-*.sqlite.json"))), 2)

    def test_failure_is_recorded_without_sql_or_private_paths(self):
        invalid = self.root / "invalid.sqlite"
        invalid.write_text("not a database: synthetic-secret")
        with self.assertRaises(backup.BackupError):
            backup.run_backup(invalid, self.output)
        result = json.loads((self.output / "latest-status.json").read_text())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["code"], "backup_failed_snapshot")
        self.assertEqual(result["phase"], "snapshot")
        self.assertEqual(result["error_type"], "DatabaseError")
        self.assertNotIn(str(self.root), json.dumps(result))
        self.assertEqual(list(self.output.glob("bora-db-*")), [])

    def test_source_in_backup_directory_is_refused(self):
        with self.assertRaisesRegex(backup.BackupError, "source_database_path_refused"):
            backup.run_backup(self.source, self.root)

    def test_symlink_source_is_refused_where_supported(self):
        alias = self.root / "alias.sqlite"
        try:
            alias.symlink_to(self.source)
        except OSError:
            self.skipTest("platform requires symlink permission")
        with self.assertRaisesRegex(backup.BackupError, "symlink_path_refused"):
            backup.run_backup(alias, self.output)

    def test_streaming_envelope_decrypts_with_private_key_and_authenticates_header(self):
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import padding, rsa
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        except ImportError:
            if os.environ.get("BORA_REQUIRE_BACKUP_CRYPTO_TESTS") == "1":
                self.fail("cryptography required for encryption integration tests")
            self.skipTest("cryptography unavailable")
        private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        pem = self.root / "public.pem"
        pem.write_bytes(private.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
        result = backup.run_backup(self.source, self.output, public_key=pem)
        data = (self.output / result["file"]).read_bytes()
        self.assertTrue(data.startswith(backup.MAGIC))
        header_size = struct.unpack(">I", data[len(backup.MAGIC):len(backup.MAGIC) + 4])[0]
        offset = len(backup.MAGIC) + 4 + header_size
        aad = data[:offset]
        header = json.loads(data[len(backup.MAGIC) + 4:offset])
        self.assertEqual(header["algorithm"], backup.ALGORITHM)
        key = private.decrypt(base64.b64decode(header["wrapped_key"]), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        decrypt = Cipher(algorithms.AES(key), modes.GCM(base64.b64decode(header["nonce"]), data[-16:])).decryptor()
        decrypt.authenticate_additional_data(aad)
        plaintext = decrypt.update(data[offset:-16]) + decrypt.finalize()
        metadata = json.loads((self.output / (result["file"] + ".json")).read_text())
        self.assertEqual(len(plaintext), header["plaintext_size"])
        self.assertEqual(hashlib.sha256(plaintext).hexdigest(), metadata["plaintext_sha256"])
        self.assertTrue(metadata["encryption_verified"])
        self.assertTrue(result["encrypted"])
        self.assertEqual(list(self.output.glob("*.sqlite")), [])
        self.assertNotIn(b"synthetic-private-data", data)
        tampered = Cipher(algorithms.AES(key), modes.GCM(base64.b64decode(header["nonce"]), data[-16:])).decryptor()
        tampered.authenticate_additional_data(aad + b"modified")
        tampered.update(data[offset:-16])
        with self.assertRaises(Exception):
            tampered.finalize()


if __name__ == "__main__":
    unittest.main()
