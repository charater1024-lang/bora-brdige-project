from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SERVER_DIRECTORY = Path(__file__).resolve().parents[1] / "local-llm-server"


def load_module(name: str):
    spec = importlib.util.spec_from_file_location(name, SERVER_DIRECTORY / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


security = load_module("gateway_security")
setup = load_module("setup_tokens")
# Public test fixtures, not deployment credentials.
API = "89ae02d74615fb30e8703465d791ba2c9f683ea4970264d1"
ADMIN = "5ec0f92634a780cd123ab8d4960fe538d7031ba9482e650f"


def environment(api: str = API, admin: str = ADMIN):
    return {"LOCAL_LLM_API_KEY": api, "LOCAL_LLM_ADMIN_TOKEN": admin}


class GatewayAuthenticationTests(unittest.TestCase):
    def assert_unconfigured(self, settings):
        for role in ("api", "admin"):
            for provided in ("", API, ADMIN):
                with self.subTest(role=role, provided=provided):
                    with self.assertRaises(security.TokenConfigurationError):
                        security.require_token(settings, role, provided)

    def test_missing_either_or_both_credentials_fails_closed(self):
        for settings in ({}, {"LOCAL_LLM_API_KEY": API}, {"LOCAL_LLM_ADMIN_TOKEN": ADMIN}):
            with self.subTest(settings=list(settings)):
                self.assert_unconfigured(settings)

    def test_empty_and_short_credentials_fail_closed_for_both_roles(self):
        for bad in ("", "short", API[:31]):
            self.assert_unconfigured(environment(api=bad))
            self.assert_unconfigured(environment(admin=bad))

    def test_example_credentials_fail_closed_even_when_long_enough(self):
        for bad in (
            "replace-with-a-random-token-that-is-over-32-characters",
            "replace-with-a-separate-random-token",
            "CHANGE_ME_TO_A_SECURE_RANDOM_TOKEN_123456",
            "your-admin-token-must-be-a-long-secret",
            "placeholder-012345678901234567890123456789",
            "example-token-012345678901234567890123456789",
            "a" * 64,
        ):
            self.assert_unconfigured(environment(api=bad))
            self.assert_unconfigured(environment(admin=bad))

    def test_whitespace_controls_and_non_ascii_configuration_rejected(self):
        for bad in (" " + API, API + "\n", API + "\x00", "한" * 32):
            self.assert_unconfigured(environment(api=bad))

    def test_identical_tokens_fail_closed_for_both_roles(self):
        self.assert_unconfigured(environment(api=API, admin=API))

    def test_distinct_valid_credentials_are_accepted_only_in_their_roles(self):
        security.require_token(environment(), "api", API)
        security.require_token(environment(), "admin", ADMIN)
        for role, wrong in (("api", ADMIN), ("admin", API)):
            with self.assertRaises(security.InvalidTokenError):
                security.require_token(environment(), role, wrong)

    def test_minimum_32_character_boundary(self):
        security.require_token(environment(API[:32], ADMIN[:32]), "api", API[:32])

    def test_wrong_missing_unicode_and_case_changed_request_tokens_are_unauthorized(self):
        for wrong in ("", "wrong", "한글", API.upper(), API + " "):
            with self.subTest(wrong=wrong):
                with self.assertRaises(security.InvalidTokenError):
                    security.require_token(environment(), "api", wrong)

    def test_configuration_and_request_comparisons_are_constant_time(self):
        with patch.object(security.secrets, "compare_digest", wraps=security.secrets.compare_digest) as compare:
            security.require_token(environment(), "api", API)
            compare.assert_any_call(API, ADMIN)
            compare.assert_any_call(API.encode("ascii"), API.encode("utf-8"))

    def test_credentials_and_configuration_errors_do_not_expose_values(self):
        tokens = security.GatewayTokens.from_environment(environment())
        self.assertNotIn(API, repr(tokens))
        self.assertNotIn(ADMIN, repr(tokens))
        with self.assertRaises(security.TokenConfigurationError) as failure:
            security.GatewayTokens(API, API)
        self.assertNotIn(API, str(failure.exception))

    def test_revalidates_environment_after_configuration_changes(self):
        settings = environment()
        security.require_token(settings, "api", API)
        settings["LOCAL_LLM_ADMIN_TOKEN"] = API
        self.assert_unconfigured(settings)


class TokenSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.template = self.directory / ".env.example"
        shutil.copyfile(SERVER_DIRECTORY / ".env.example", self.template)
        self.destination = self.directory / ".env"

    def read_environment(self):
        return dict(
            line.split("=", 1)
            for line in self.destination.read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#") and "=" in line
        )

    def test_example_has_blank_secrets_and_portable_state_path(self):
        template = self.template.read_text(encoding="utf-8")
        self.assertIn("LOCAL_LLM_API_KEY=\n", template)
        self.assertIn("LOCAL_LLM_ADMIN_TOKEN=\n", template)
        self.assertIn("LOCAL_LLM_STATE_PATH=./runtime/model-state.json", template)
        self.assertNotIn("/home/", template)

    def test_generates_two_independent_256_bit_tokens_without_output(self):
        with patch("builtins.print") as output, patch.object(setup.secrets, "token_urlsafe", wraps=setup.secrets.token_urlsafe) as random:
            self.assertEqual(setup.initialize_env(self.directory), self.destination)
        output.assert_not_called()
        self.assertEqual(random.call_count, 2)
        random.assert_called_with(32)
        settings = self.read_environment()
        tokens = security.GatewayTokens.from_environment(settings)
        self.assertEqual(len(tokens.api), 43)
        self.assertEqual(len(tokens.admin), 43)
        self.assertNotEqual(tokens.api, tokens.admin)
        self.assertEqual(settings["LOCAL_LLM_STATE_PATH"], "./runtime/model-state.json")
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o600)

    def test_existing_env_is_never_overwritten_by_default(self):
        self.destination.write_text("private-original-content\n", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            setup.initialize_env(self.directory)
        self.assertEqual(self.destination.read_text(encoding="utf-8"), "private-original-content\n")

    def test_explicit_rotation_preserves_settings_and_removes_duplicate_assignments(self):
        self.destination.write_text(
            f"# custom settings\nexport LOCAL_LLM_API_KEY={API}\nLOCAL_LLM_API_KEY=duplicate\n"
            f"LOCAL_LLM_ADMIN_TOKEN={ADMIN}\nOLLAMA_KEEP_ALIVE=30m\nCUSTOM_SETTING=keep-this\n",
            encoding="utf-8",
        )
        setup.initialize_env(self.directory, overwrite=True)
        content = self.destination.read_text(encoding="utf-8")
        tokens = security.GatewayTokens.from_environment(self.read_environment())
        self.assertNotEqual(tokens.api, API)
        self.assertNotEqual(tokens.admin, ADMIN)
        self.assertIn("# custom settings\n", content)
        self.assertIn("CUSTOM_SETTING=keep-this\n", content)
        self.assertIn("OLLAMA_KEEP_ALIVE=30m\n", content)
        self.assertEqual(content.count("LOCAL_LLM_API_KEY="), 1)
        self.assertNotIn(API, content)
        self.assertNotIn(ADMIN, content)
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o600)

    def test_rotation_failure_keeps_original_and_removes_temporary_secret_file(self):
        original = "LOCAL_LLM_API_KEY=original\n"
        self.destination.write_text(original, encoding="utf-8")
        with patch.object(setup.os, "replace", side_effect=OSError("simulated failure")):
            with self.assertRaises(OSError):
                setup.initialize_env(self.directory, overwrite=True)
        self.assertEqual(self.destination.read_text(encoding="utf-8"), original)
        self.assertEqual(sorted(path.name for path in self.directory.iterdir()), [".env", ".env.example"])

    def test_symlink_is_rejected_even_with_force(self):
        with patch.object(Path, "is_symlink", return_value=True):
            for overwrite in (False, True):
                with self.assertRaisesRegex(ValueError, "symlink"):
                    setup.initialize_env(self.directory, overwrite=overwrite)
        self.assertFalse(self.destination.exists())

    def test_initial_creation_is_exclusive_if_another_process_creates_env(self):
        original_link = os.link

        def concurrent_link(source, destination):
            self.destination.write_text("concurrent-content\n", encoding="utf-8")
            return original_link(source, destination)

        with patch.object(setup.os, "link", side_effect=concurrent_link):
            with self.assertRaises(FileExistsError):
                setup.initialize_env(self.directory)
        self.assertEqual(self.destination.read_text(encoding="utf-8"), "concurrent-content\n")
        self.assertEqual(sorted(path.name for path in self.directory.iterdir()), [".env", ".env.example"])

    def test_multiline_settings_are_rejected_before_rotation_without_revealing_content(self):
        token_assignment = "LOCAL_LLM_API_KEY="
        samples = (
            token_assignment + f'"{API[:32]}\\\n{API[32:]}"\n',
            token_assignment + f"'{API[:32]}\n{API[32:]}'\n",
            f'CUSTOM_SETTING="first\nLOCAL_LLM_API_KEY={API}\nlast"\n',
            "CUSTOM_SETTING=first\\\nsecond\n",
        )
        for original in samples:
            with self.subTest(syntax=samples.index(original)):
                self.destination.write_text(original, encoding="utf-8")
                with patch.object(setup.secrets, "token_urlsafe") as random:
                    with self.assertRaisesRegex(ValueError, "Multiline or continued") as failure:
                        setup.initialize_env(self.directory, overwrite=True)
                random.assert_not_called()
                self.assertNotIn(API, str(failure.exception))
                self.assertEqual(self.destination.read_text(encoding="utf-8"), original)
                self.assertEqual(sorted(path.name for path in self.directory.iterdir()), [".env", ".env.example"])

    def test_multiline_template_does_not_create_env(self):
        self.template.write_text('CUSTOM_SETTING="first\nsecond"\n', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Multiline or continued"):
            setup.initialize_env(self.directory)
        self.assertEqual([path.name for path in self.directory.iterdir()], [".env.example"])

    def test_single_line_quotes_comments_and_utf8_bom_are_supported(self):
        preserved = (
            '# owner\'s "comment" can contain quotes or a trailing slash \\\n'
            'CUSTOM_SETTING="a value with # and \\\"escaped quotes\\\""\n'
            "ANOTHER_SETTING='literal \\ and # characters'\n"
        )
        self.destination.write_text(
            f'\ufeffLOCAL_LLM_API_KEY="{API}" # old token\n'
            f"LOCAL_LLM_ADMIN_TOKEN='{ADMIN}'\n{preserved}", encoding="utf-8",
        )
        setup.initialize_env(self.directory, overwrite=True)
        content = self.destination.read_text(encoding="utf-8")
        self.assertIn(preserved, content)
        self.assertNotIn("\ufeff", content)
        self.assertNotIn(API, content)
        self.assertNotIn(ADMIN, content)

    def test_partial_write_failure_never_publishes_a_partial_env(self):
        original_fdopen = os.fdopen

        class FailingWriter:
            def __init__(self, *arguments, **options):
                self.file = original_fdopen(*arguments, **options)

            def __enter__(self):
                return self

            def write(self, content):
                self.file.write(content[:5])
                self.file.flush()
                raise OSError("simulated write failure")

            def __exit__(self, *arguments):
                self.file.close()

        for overwrite in (False, True):
            with self.subTest(overwrite=overwrite):
                original = f"LOCAL_LLM_API_KEY={API}\nLOCAL_LLM_ADMIN_TOKEN={ADMIN}\n"
                if overwrite:
                    self.destination.write_text(original, encoding="utf-8")
                with patch.object(setup.os, "fdopen", FailingWriter):
                    with self.assertRaisesRegex(OSError, "simulated write failure"):
                        setup.initialize_env(self.directory, overwrite=overwrite)
                if overwrite:
                    self.assertEqual(self.destination.read_text(encoding="utf-8"), original)
                else:
                    self.assertFalse(self.destination.exists())
                self.assertFalse(list(self.directory.glob(".env.*.tmp")))
        # A first-time failure must not leave an env that blocks the next retry.
        self.destination.unlink()
        setup.initialize_env(self.directory)
        security.GatewayTokens.from_environment(self.read_environment())

    def test_sync_failure_keeps_original_or_absence_and_cleans_temporary_file(self):
        for overwrite in (False, True):
            with self.subTest(overwrite=overwrite):
                if overwrite:
                    self.destination.write_text("CUSTOM_SETTING=unchanged\n", encoding="utf-8")
                with patch.object(setup.os, "fsync", side_effect=OSError("simulated sync failure")):
                    with self.assertRaises(OSError):
                        setup.initialize_env(self.directory, overwrite=overwrite)
                if overwrite:
                    self.assertEqual(self.destination.read_text(encoding="utf-8"), "CUSTOM_SETTING=unchanged\n")
                else:
                    self.assertFalse(self.destination.exists())
                self.assertFalse(list(self.directory.glob(".env.*.tmp")))

    def test_unsupported_hard_links_fail_without_a_partial_env(self):
        with patch.object(setup.os, "link", side_effect=OSError("hard links unavailable")):
            with self.assertRaises(OSError):
                setup.initialize_env(self.directory)
        self.assertFalse(self.destination.exists())
        self.assertEqual([path.name for path in self.directory.iterdir()], [".env.example"])

    def test_cli_creates_silently_refuses_overwrite_and_rotates_only_with_force(self):
        for name in ("setup_tokens.py", "gateway_security.py"):
            shutil.copyfile(SERVER_DIRECTORY / name, self.directory / name)
        command = [sys.executable, str(self.directory / "setup_tokens.py")]
        created = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(created.returncode, 0, created.stderr)
        original = self.destination.read_text(encoding="utf-8")
        tokens = security.GatewayTokens.from_environment(self.read_environment())
        refused = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.destination.read_text(encoding="utf-8"), original)
        rotated = subprocess.run(command + ["--force"], capture_output=True, text=True, check=False)
        self.assertEqual(rotated.returncode, 0, rotated.stderr)
        new_tokens = security.GatewayTokens.from_environment(self.read_environment())
        self.assertNotEqual(tokens.api, new_tokens.api)
        output = "".join(result.stdout + result.stderr for result in (created, refused, rotated))
        for secret in (tokens.api, tokens.admin, new_tokens.api, new_tokens.admin):
            self.assertNotIn(secret, output)


if __name__ == "__main__":
    unittest.main()
