"""Cross-platform encryption/restore contract tests; no DPAPI, network or real keys."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "deploy" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = load("bora_server_envelope_test", "backup-bora-sqlite.py")
client = load("bora_client_envelope_test", "windows-backup-client.py")


class WindowsBackupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cls.wrong_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="bora-envelope-contract-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        source = self.root / "synthetic.sqlite"
        database = sqlite3.connect(source)
        database.execute("CREATE TABLE synthetic (content BLOB)")
        database.execute("INSERT INTO synthetic VALUES (?)", (b"synthetic" * 300000,))
        database.commit()
        database.close()
        pem = self.root / "synthetic-public.pem"
        pem.write_bytes(self.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
        output = self.root / "encrypted"
        result = backup.run_backup(source, output, public_key=pem)
        self.artifact = output / result["file"]
        self.metadata = json.loads((output / (result["file"] + ".json")).read_text())

    def tearDown(self):
        self.assertEqual(list(self.root.glob(".restore-check-*")), [])

    def replace_artifact(self, data):
        self.artifact.write_bytes(data)
        self.metadata.update(size=len(data), sha256=hashlib.sha256(data).hexdigest())

    def test_server_binary_envelope_decrypts_and_restores_in_independent_client(self):
        result = client.verify_envelope(self.artifact, self.metadata, self.key, self.root)
        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["decryption_verified"])
        self.assertTrue(result["restore_verified"])
        self.assertTrue(result["plaintext_removed"])
        self.assertEqual(result["table_count"], 1)
        self.assertGreater(self.metadata["plaintext_size"], 2 * 1024 * 1024)

    def test_wrong_rsa_key_is_rejected_before_decryption(self):
        with self.assertRaisesRegex(client.ClientError, "wrong_recovery_key"):
            client.verify_envelope(self.artifact, self.metadata, self.wrong_key, self.root)

    def test_ciphertext_tamper_is_rejected_even_if_transport_hash_is_updated(self):
        data = bytearray(self.artifact.read_bytes())
        data[-32] ^= 1
        self.replace_artifact(data)
        with self.assertRaises(Exception):
            client.verify_envelope(self.artifact, self.metadata, self.key, self.root)

    def test_gcm_tag_tamper_is_rejected_even_if_transport_hash_is_updated(self):
        data = bytearray(self.artifact.read_bytes())
        data[-1] ^= 1
        self.replace_artifact(data)
        with self.assertRaises(Exception):
            client.verify_envelope(self.artifact, self.metadata, self.key, self.root)

    def test_header_tamper_is_authenticated_not_only_parsed(self):
        data = self.artifact.read_bytes()
        prefix_size = len(client.MAGIC) + 4
        size = struct.unpack(">I", data[len(client.MAGIC):prefix_size])[0]
        header = json.loads(data[prefix_size:prefix_size + size])
        # Reorder identical JSON values. Semantic parsing succeeds; AAD must not.
        changed = json.dumps(header, sort_keys=False, separators=(", ", ": ")).encode()
        self.replace_artifact(client.MAGIC + struct.pack(">I", len(changed)) + changed + data[prefix_size + size:])
        with self.assertRaises(Exception):
            client.verify_envelope(self.artifact, self.metadata, self.key, self.root)

    def test_plaintext_schema_metadata_mismatch_fails_restore_verification(self):
        self.metadata["table_count"] = 999
        with self.assertRaisesRegex(client.ClientError, "restored_database_schema_mismatch"):
            client.verify_envelope(self.artifact, self.metadata, self.key, self.root)

    def test_plaintext_digest_mismatch_is_not_reported_as_success(self):
        self.metadata["plaintext_sha256"] = "0" * 64
        with self.assertRaisesRegex(client.ClientError, "plaintext_hash_mismatch"):
            client.verify_envelope(self.artifact, self.metadata, self.key, self.root)

    def test_truncated_artifact_is_rejected(self):
        self.replace_artifact(self.artifact.read_bytes()[:-20])
        with self.assertRaises(client.ClientError):
            client.verify_envelope(self.artifact, self.metadata, self.key, self.root)

    def test_header_length_is_bounded_before_allocation(self):
        data = self.artifact.read_bytes()
        self.replace_artifact(client.MAGIC + struct.pack(">I", 2**32 - 1) + data[len(client.MAGIC) + 4:])
        with self.assertRaisesRegex(client.ClientError, "invalid_header_length"):
            client.verify_envelope(self.artifact, self.metadata, self.key, self.root)


if __name__ == "__main__":
    unittest.main()
