import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('public_preflight', ROOT / 'deploy/verify-public-runtime.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PublicRuntimePreflightTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='bora-preflight-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.node = Path(shutil.which('node') or os.sys.executable).resolve()
        self.api = secrets.token_urlsafe(48)
        self.admin = secrets.token_urlsafe(48)
        self.values = {
            'LOCAL_LLM_API_KEY': self.api, 'LOCAL_LLM_ADMIN_TOKEN': self.admin,
            'LOCAL_LLM_BASE_URL': 'http://127.0.0.1:11435/v1',
            'DEVELOPER_ADMIN_IDENTITIES': 'naver:Subject-ABC',
            'LEGAL_CONTACT_EMAIL': 'support@borabridge.com',
            'DEVELOPER_SETTINGS_ENCRYPTION_KEY': secrets.token_urlsafe(32),
            'SCHEDULER_SECRET': secrets.token_urlsafe(32),
            'AUTH_MODE': 'external', 'APP_BASE_URL': 'https://borabridge.com',
            'NAVER_CLIENT_ID': 'synthetic-client', 'NAVER_CLIENT_SECRET': secrets.token_urlsafe(32),
            'NAVER_REDIRECT_URI': 'https://borabridge.com/api/auth/callback/naver',
        }
        (self.root / 'package.json').write_text('{"version":"0.8.7"}', encoding='utf8')
        (self.root / 'local-llm-server').mkdir()
        self.gateway_file = self.root / 'local-llm-server/.env'
        self.gateway_file.write_text(f'LOCAL_LLM_API_KEY={self.api}\nLOCAL_LLM_ADMIN_TOKEN={self.admin}\n', encoding='utf8')
        self.gateway_file.chmod(0o600)
        directory = self.root / '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
        directory.mkdir(parents=True)
        self.database = directory / 'fixture.sqlite'
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('CREATE TABLE oauth_users (provider TEXT, provider_subject TEXT)')
            db.execute('INSERT INTO oauth_users VALUES (?, ?)', ('naver', 'Subject-ABC'))
            db.execute('CREATE TABLE ai_provider_settings (provider TEXT, model_id TEXT, enabled INTEGER)')
            db.execute('INSERT INTO ai_provider_settings VALUES (?, ?, 1)', ('local', 'synthetic-model'))
        self.save_env()
        scheduler = self.root / '.env.scheduler'
        scheduler.write_text(f"SCHEDULER_SECRET={self.values['SCHEDULER_SECRET']}\nPUBLIC_DATA_REFRESH_URL=http://127.0.0.1:3000\n", encoding='utf8')
        scheduler.chmod(0o600)

    def save_env(self):
        path = self.root / '.env.local'
        path.write_text(''.join(f'{key}={value}\n' for key, value in self.values.items()), encoding='utf8')
        path.chmod(0o600)

    def run_check(self, **kwargs):
        # The preflight never invokes real services. Node version is the sole
        # subprocess in these platform-independent private-config tests.
        with patch.object(preflight.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'v22.23.1\n', b'')):
            return preflight.check_runtime(self.root, ROOT, self.node, render_units=False, **kwargs)

    def test_complete_config_passes_without_mutating_files_or_database(self):
        before = {path.relative_to(self.root).as_posix(): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        result = self.run_check()
        self.assertEqual(result['status'], 'ready', result)
        self.assertFalse(result['deployment_performed'])
        after = {path.relative_to(self.root).as_posix(): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        self.assertEqual(before, after)

    def test_missing_admin_and_contact_block_without_exposing_values(self):
        self.values['DEVELOPER_ADMIN_IDENTITIES'] = ''
        self.values['LEGAL_CONTACT_EMAIL'] = ''
        self.save_env()
        result = self.run_check()
        self.assertEqual(result['status'], 'blocked')
        failed = {item['name'] for item in result['checks'] if not item['ok']}
        self.assertIn('public_legal_contact', failed)
        self.assertIn('existing_administrator_and_inference_credential', failed)
        encoded = json.dumps(result)
        for value in [self.api, self.admin, self.values['NAVER_CLIENT_SECRET']]:
            self.assertNotIn(value, encoded)

    def test_subject_case_is_not_normalized(self):
        self.values['DEVELOPER_ADMIN_IDENTITIES'] = 'naver:subject-abc'
        self.save_env()
        result = self.run_check()
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(any(item.get('reason') == 'administrator_identity_not_in_existing_accounts' for item in result['checks']))

    def test_gateway_mismatch_and_placeholder_block(self):
        self.values['LOCAL_LLM_API_KEY'] = secrets.token_urlsafe(48)
        self.save_env()
        self.assertEqual(self.run_check()['status'], 'blocked')
        self.gateway_file.write_text('LOCAL_LLM_API_KEY=replace-with-random-token\nLOCAL_LLM_ADMIN_TOKEN=replace-with-other-token\n', encoding='utf8')
        self.assertTrue(any(item['name'] == 'gateway_token_configuration' and not item['ok'] for item in self.run_check()['checks']))

    def test_ambiguous_databases_block(self):
        (self.database.parent / 'another.sqlite').write_bytes(b'')
        self.assertTrue(any(item.get('reason') == 'database_selection_ambiguous_or_unsafe' for item in self.run_check()['checks']))

    def test_duplicate_environment_rejected(self):
        path = self.root / '.env.local'
        with path.open('a', encoding='utf8') as output:
            output.write('AUTH_MODE=sites\n')
        self.assertTrue(any(item['name'] == 'private_web_configuration' and not item['ok'] for item in self.run_check()['checks']))

    def test_bad_oauth_origin_blocks(self):
        self.values['NAVER_REDIRECT_URI'] = 'https://wrong.example.test/callback'
        self.save_env()
        self.assertTrue(any(item['name'] == 'oauth_canonical_origin' and not item['ok'] for item in self.run_check()['checks']))

    def test_scheduler_unit_default_is_allowed_but_overrides_must_match(self):
        scheduler = self.root / '.env.scheduler'
        shared = f"SCHEDULER_SECRET={self.values['SCHEDULER_SECRET']}\n"
        scheduler.write_text(shared, encoding='utf8')
        self.assertEqual(self.run_check()['status'], 'ready')
        for content in (shared + 'PUBLIC_DATA_REFRESH_URL=https://wrong.example.test\n',
                        f'SCHEDULER_SECRET={secrets.token_urlsafe(32)}\n'):
            scheduler.write_text(content, encoding='utf8')
            self.assertTrue(any(item['name'] == 'scheduler_private_config_matches' and not item['ok'] for item in self.run_check()['checks']))

    def test_missing_endpoint_disabled_ai_and_insecure_flags_never_pass(self):
        self.values.pop('LOCAL_LLM_BASE_URL')
        self.save_env()
        self.assertEqual(self.run_check()['status'], 'blocked')
        self.values['LOCAL_LLM_BASE_URL'] = 'http://127.0.0.1:11435/v1'
        for flag in ('1', 'yes', 'true'):
            self.values['AUTH_ALLOW_INSECURE_LAN'] = flag
            self.save_env()
            self.assertTrue(any(item['name'] == 'oauth_canonical_origin' and not item['ok'] for item in self.run_check()['checks']))
        self.values['AUTH_ALLOW_INSECURE_LAN'] = 'false'
        self.save_env()
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute('UPDATE ai_provider_settings SET enabled=0')
        self.assertTrue(any(item.get('reason') == 'local_ai_not_exclusively_enabled' for item in self.run_check()['checks']))

    def test_malformed_private_urls_are_sanitized_even_during_probes(self):
        marker = secrets.token_hex(24)
        self.values['APP_BASE_URL'] = f'https://[{marker}'
        self.values['LOCAL_LLM_BASE_URL'] = f'http://[{marker}'
        self.save_env()
        result = self.run_check(probe=True)
        self.assertEqual(result['status'], 'blocked')
        self.assertNotIn(marker, json.dumps(result))

    def test_invalid_ports_fail_offline_but_valid_custom_ports_are_allowed(self):
        invalid_ports = ('bogus', '999999', '0', '-1', '')
        for port in invalid_ports:
            with self.subTest(endpoint_port=port):
                self.values['LOCAL_LLM_BASE_URL'] = f'http://127.0.0.1:{port}/v1'
                self.save_env()
                result = self.run_check()
                self.assertEqual(result['status'], 'blocked')
                self.assertTrue(any(item['name'] == 'loopback_local_ai_endpoint' and not item['ok'] for item in result['checks']))
        self.values['LOCAL_LLM_BASE_URL'] = 'http://127.0.0.1:11436/v1'
        for port in invalid_ports:
            with self.subTest(oauth_port=port):
                self.values['APP_BASE_URL'] = f'https://borabridge.com:{port}'
                self.values['NAVER_REDIRECT_URI'] = self.values['APP_BASE_URL'] + '/api/auth/callback/naver'
                self.save_env()
                result = self.run_check()
                self.assertTrue(any(item['name'] == 'oauth_canonical_origin' and not item['ok'] for item in result['checks']))
        self.values['APP_BASE_URL'] = 'https://borabridge.com:8443'
        self.values['NAVER_REDIRECT_URI'] = self.values['APP_BASE_URL'] + '/api/auth/callback/naver'
        self.save_env()
        self.assertEqual(self.run_check()['status'], 'ready')
        self.assertTrue(preflight.local_endpoint('http://[::1]:11436/v1'))

    def test_probe_invalid_ports_are_sanitized_before_network_access(self):
        private_marker = secrets.token_hex(24)
        with patch.object(preflight, 'build_opener') as opener:
            for port in ('bogus', '999999', '0', '-1', '', private_marker):
                with self.subTest(port=port):
                    with self.assertRaises(preflight.PreflightError) as raised:
                        preflight.probe_json(f'http://127.0.0.1:{port}/v1/models', {'Authorization': 'Bearer synthetic'})
                    self.assertEqual(str(raised.exception), 'probe_url_invalid')
                    self.assertNotIn(private_marker, str(raised.exception))
            opener.assert_not_called()

    def test_sandbox_parity_rejects_project_and_home_private_runtime_paths(self):
        home = self.root / 'service-home'
        for directory in (self.root / '.git', self.root / '.deploy-backups', home / '.cache', home / '.config'):
            with self.subTest(mask=directory.name):
                self.assertFalse(preflight.sandbox_paths_compatible(self.root, directory / 'bin/node', home))
                self.assertFalse(preflight.sandbox_paths_compatible(self.root, directory, home))
        self.assertFalse(preflight.sandbox_paths_compatible(home / '.cache/candidate', self.node, home))
        self.assertTrue(preflight.sandbox_paths_compatible(self.root, self.root / 'node-runtime/bin/node', home))
        self.assertTrue(preflight.sandbox_paths_compatible(self.root, self.root / '.git-tools/bin/node', home))

    def test_network_probes_are_optional_bounded_and_use_read_only_routes(self):
        responses = [{'status': 'ok'}, {'data': [{}]}, {'state': 'ready', 'selected_model': 'synthetic-model', 'loaded_model': 'synthetic-model'}]
        with patch.object(preflight, 'probe_json', side_effect=responses) as probe:
            self.assertEqual(self.run_check(probe=True)['status'], 'ready')
        self.assertEqual([call.args[0] for call in probe.call_args_list], [
            'http://127.0.0.1:3000/api/health', 'http://127.0.0.1:11435/v1/models', 'http://127.0.0.1:11435/admin/status'])

    def test_probe_rejects_remote_credential_destinations_without_network(self):
        userinfo = f'{secrets.token_hex(12)}:{secrets.token_urlsafe(24)}'
        with patch.object(preflight, 'build_opener') as opener:
            for url in ['https://example.com/v1/models', 'http://192.0.2.1/v1/models', 'http://127.0.0.1:11435/v1/models?token=private', f'http://{userinfo}@127.0.0.1/']:
                with self.assertRaises(preflight.PreflightError):
                    preflight.probe_json(url, {'Authorization': 'Bearer synthetic'})
            opener.assert_not_called()


if __name__ == '__main__':
    unittest.main()
