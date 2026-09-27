#!/usr/bin/env python3
"""Read-only existing-installation preflight. Never emits configuration values.

Candidate source and production configuration may be in different directories.
No service-manager mutations, environment writes, SQL writes, or model loads.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import types
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class PreflightError(ValueError):
    pass


def private_environment(path: Path) -> dict[str, str]:
    if path.is_symlink() or not path.is_file():
        raise PreflightError('private_config_missing_or_symlink')
    info = path.stat()
    if os.name == 'posix' and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077):
        raise PreflightError('private_config_owner_or_permissions')
    result = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.fullmatch(r'\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)', line)
        if not match or match[1] in result:
            raise PreflightError('private_config_invalid_or_duplicate_assignment')
        value = match[2].strip()
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise PreflightError('private_config_multiline_unsupported')
            if value[0] == '"':
                try:
                    value = json.loads(value)
                except ValueError:
                    value = value[1:-1]
            else:
                value = value[1:-1]
        result[match[1]] = value
    return result


def public_contact(value: str) -> bool:
    return len(value) <= 254 and bool(re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}", value)) and not re.search(r'(?:^|\.)(?:example\.(?:com|org|net)|invalid|test|localhost)$', value.partition('@')[2], re.I)


def valid_url_port(address) -> bool:
    # urlsplit().hostname does not validate ports: explicitly read .port so
    # malformed/non-numeric and out-of-range ports cannot pass offline checks.
    try:
        port = address.port
    except ValueError:
        return False
    return not address.netloc.endswith(':') and (port is None or 1 <= port <= 65535)


def local_endpoint(value: str) -> bool:
    url = urlsplit(value)
    return url.scheme in ('http', 'https') and valid_url_port(url) and bool(url.hostname) and ipaddress.ip_address(url.hostname).is_loopback and not url.username and not url.password and not url.query and not url.fragment and url.path.rstrip('/') == '/v1'


def sandbox_paths_compatible(project: Path, node: Path, home: Path) -> bool:
    home = home.resolve()
    project = project.resolve()
    masks = [home / item for item in ('.config', '.cache', '.ssh', '.gnupg', '.cloudflared', '.aws', '.azure', '.kube', '.docker', '.vscode-server', '.cursor-server', '.codex', '.claude', '.local/share/keyrings')]
    masks.extend(project / item for item in ('.git', '.deploy-backups'))
    return not any(target == mask or mask in target.parents for mask in masks for target in (node.resolve(), project))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def probe_json(url: str, headers: dict[str, str]) -> dict:
    try:
        address = urlsplit(url)
    except ValueError:
        raise PreflightError('probe_url_invalid') from None
    if address.scheme not in ('http', 'https') or not valid_url_port(address) or address.username or address.password or address.query or address.fragment:
        raise PreflightError('probe_url_invalid')
    try:
        if not ipaddress.ip_address(address.hostname or '').is_loopback:
            raise ValueError()
    except ValueError:
        raise PreflightError('probe_requires_literal_loopback') from None
    # Disable redirects and ambient proxies: credentials never leave loopback.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(Request(url, headers=headers), timeout=5) as response:
        body = response.read(65537)
        if response.status != 200 or len(body) > 65536:
            raise PreflightError('probe_status_or_size')
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise PreflightError('probe_payload_invalid')
        return parsed


def check_runtime(project: Path, source: Path, node: Path, *, env_file: Path | None = None,
                  gateway_env_file: Path | None = None, probe: bool = False, render_units: bool = True) -> dict:
    checks = []
    observed = {'local_model': None}

    def check(name, action):
        try:
            ok = action()
            if ok is False:
                raise PreflightError('condition_failed')
            checks.append({'name': name, 'ok': True})
            return True
        except Exception as error:
            # Only our fixed error codes can cross the diagnostic boundary.
            code = str(error) if isinstance(error, PreflightError) else 'check_failed'
            checks.append({'name': name, 'ok': False, 'reason': code})
            return False

    def canonical_root(path):
        return path.is_absolute() and path.is_dir() and not path.is_symlink() and path.resolve() == path and (os.name != 'posix' or bool(re.fullmatch(r'/[A-Za-z0-9._/-]+', str(path))))

    roots_ok = check('canonical_source_and_target', lambda: canonical_root(project) and canonical_root(source) and (project / 'package.json').is_file())
    check('candidate_required_files', lambda: all((source / item).is_file() and not (source / item).is_symlink() for item in (
        'package.json', 'deploy/deployment-paths.sh', 'deploy/install-user-units.sh',
        'deploy/run-bora-sandbox.sh', 'deploy/stop-local-worker.sh',
        'local-llm-server/app.py', 'local-llm-server/gateway_security.py',
    )))
    def node_ready():
        if not node.is_absolute() or not node.is_file() or not os.access(node, os.X_OK):
            return False
        result = subprocess.run([str(node), '--version'], capture_output=True, timeout=10, check=True)
        version = re.fullmatch(rb'v(\d+)\.(\d+)\.(\d+)\s*', result.stdout)
        return bool(version and tuple(int(x) for x in version.groups()) >= (22, 16, 0))
    check('explicit_node_runtime', node_ready)
    def sandbox_paths_ready():
        if os.name != 'posix':
            return True
        import pwd
        return sandbox_paths_compatible(project, node, Path(pwd.getpwuid(os.getuid()).pw_dir))
    check('sandbox_runtime_paths', sandbox_paths_ready)
    values, gateway = {}, {}
    def load_config(destination, path):
        destination.update(private_environment(path))
    env_ok = check('private_web_configuration', lambda: load_config(values, env_file or project / '.env.local'))
    gateway_ok = check('private_gateway_configuration', lambda: load_config(gateway, gateway_env_file or project / 'local-llm-server/.env'))
    if env_ok:
        check('public_legal_contact', lambda: public_contact(values.get('LEGAL_CONTACT_EMAIL', '').strip()))
        check('credential_encryption_key', lambda: len(values.get('DEVELOPER_SETTINGS_ENCRYPTION_KEY', '')) >= 32)
        check('scheduler_authentication', lambda: len(values.get('SCHEDULER_SECRET', '')) >= 32)
        def scheduler_ready():
            settings = private_environment(project / '.env.scheduler')
            # The shipped unit supplies this loopback default; the private
            # EnvironmentFile only needs the shared authentication secret.
            endpoint = settings.get('PUBLIC_DATA_REFRESH_URL', 'http://127.0.0.1:3000')
            return settings.get('SCHEDULER_SECRET') == values.get('SCHEDULER_SECRET') and endpoint.rstrip('/') == 'http://127.0.0.1:3000'
        check('scheduler_private_config_matches', scheduler_ready)
        check('loopback_local_ai_endpoint', lambda: local_endpoint(values.get('LOCAL_LLM_BASE_URL', '')))
        def oauth_ready():
            origin = urlsplit(values.get('APP_BASE_URL', ''))
            if values.get('AUTH_MODE') != 'external' or origin.scheme != 'https' or not valid_url_port(origin) or not origin.hostname or origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment:
                return False
            if values.get('AUTH_ALLOW_INSECURE_LAN', '').lower() in ('true', '1', 'yes'):
                return False
            providers = [('google', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'), ('naver', 'NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET', 'NAVER_REDIRECT_URI'), ('kakao', 'KAKAO_REST_API_KEY', None, 'KAKAO_REDIRECT_URI')]
            configured = 0
            for provider, client, secret, redirect in providers:
                if not values.get(client):
                    continue
                configured += 1
                if (secret and not values.get(secret)) or values.get(redirect) != f'{origin.scheme}://{origin.netloc}/api/auth/callback/{provider}':
                    return False
            return configured > 0
        check('oauth_canonical_origin', oauth_ready)
    if gateway_ok and roots_ok:
        def gateway_valid():
            module = types.ModuleType('_bora_preflight_gateway')
            sys.modules[module.__name__] = module
            try:
                exec(compile((source / 'local-llm-server/gateway_security.py').read_bytes(), 'gateway_security.py', 'exec'), module.__dict__)
                module.GatewayTokens.from_environment(gateway)
            finally:
                sys.modules.pop(module.__name__, None)
        check('gateway_token_configuration', gateway_valid)
    if env_ok and gateway_ok:
        check('web_gateway_admin_token_match', lambda: bool(values.get('LOCAL_LLM_ADMIN_TOKEN')) and values['LOCAL_LLM_ADMIN_TOKEN'] == gateway.get('LOCAL_LLM_ADMIN_TOKEN'))
        def database_ready():
            directory = project / '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'
            candidates = [path for path in directory.glob('*.sqlite') if path.name != 'metadata.sqlite']
            if len(candidates) != 1 or candidates[0].is_symlink() or directory.resolve() != directory:
                raise PreflightError('database_selection_ambiguous_or_unsafe')
            identities = []
            for value in values.get('DEVELOPER_ADMIN_IDENTITIES', '').split(','):
                match = re.fullmatch(r'(google|naver|kakao):([^\s,]+)', value.strip(), re.I)
                if not match:
                    raise PreflightError('administrator_identity_missing_or_invalid')
                identities.append((match[1].lower(), match[2]))
            with closing(sqlite3.connect(candidates[0].as_uri() + '?mode=ro', uri=True, timeout=5)) as database:
                database.execute('PRAGMA query_only=ON')
                for provider, subject in identities:
                    if not database.execute('SELECT 1 FROM oauth_users WHERE provider=? AND provider_subject=? LIMIT 1', (provider, subject)).fetchone():
                        raise PreflightError('administrator_identity_not_in_existing_accounts')
                # This preflight is explicitly for the existing Local-AI
                # production profile. An intentionally disabled/paid-only AI
                # setup needs a separately reviewed profile, not a false pass.
                active = database.execute('SELECT provider, model_id FROM ai_provider_settings WHERE enabled=1').fetchall()
                if len(active) != 1 or active[0][0] != 'local' or not active[0][1]:
                    raise PreflightError('local_ai_not_exclusively_enabled')
                observed['local_model'] = active[0][1]
                token = values.get('LOCAL_LLM_API_KEY', '')
                if database.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_api_credentials'").fetchone():
                    record = database.execute('SELECT encrypted_value, iv FROM service_api_credentials WHERE key_name=?', ('LOCAL_LLM_API_KEY',)).fetchone()
                    if record:
                        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
                        cipher = AESGCM(hashlib.sha256(values.get('DEVELOPER_SETTINGS_ENCRYPTION_KEY', '').encode()).digest())
                        token = cipher.decrypt(base64.b64decode(record[1]), base64.b64decode(record[0]), b'LOCAL_LLM_API_KEY').decode()
                if not token or token != gateway.get('LOCAL_LLM_API_KEY'):
                    raise PreflightError('web_gateway_inference_token_mismatch')
        check('existing_administrator_and_inference_credential', database_ready)
    if render_units and os.name == 'posix' and roots_ok:
        def render():
            env = {**os.environ, 'BORA_PROJECT_ROOT': str(project), 'BORA_NODE_BIN': str(node)}
            units = sorted(path for path in (source / 'deploy').glob('bora-*') if path.suffix in ('.service', '.timer'))
            if not units or any(path.is_symlink() for path in units):
                return False
            node_units = sum('/usr/bin/env node' in path.read_text() or 'Environment=PATH=' in path.read_text() for path in units)
            result = subprocess.run(['/usr/bin/bash', str(source / 'deploy/install-user-units.sh'), '--print', *[path.name for path in units]], env=env, capture_output=True, timeout=15, check=True)
            return b'/usr/bin/env node' not in result.stdout and result.stdout.count(b'Environment=BORA_NODE_BIN=') == node_units
        check('rendered_unit_runtime_paths', render)
    if probe and env_ok and gateway_ok:
        def web_probe():
            origin = urlsplit(values.get('APP_BASE_URL', ''))
            return probe_json('http://127.0.0.1:3000/api/health', {'Host': origin.netloc, 'X-Forwarded-Proto': 'https'}).get('status') == 'ok'
        check('live_web_health', web_probe)
        base = values.get('LOCAL_LLM_BASE_URL', '').rstrip('/')
        check('authenticated_gateway_models', lambda: bool(probe_json(base + '/models', {'Authorization': 'Bearer ' + gateway.get('LOCAL_LLM_API_KEY', '')}).get('data')))
        def admin_probe():
            gateway_url = urlsplit(base)
            admin_url = f'{gateway_url.scheme}://{gateway_url.netloc}/admin/status'
            body = probe_json(admin_url, {'Authorization': 'Bearer ' + gateway.get('LOCAL_LLM_ADMIN_TOKEN', '')})
            return body.get('state') == 'ready' and bool(observed['local_model']) and body.get('selected_model') == observed['local_model'] and body.get('loaded_model') == observed['local_model']
        check('authenticated_gateway_admin', admin_probe)
    return {'status': 'ready' if all(item['ok'] for item in checks) else 'blocked', 'mode': 'read-only-preflight', 'profile': 'existing-local-ai-production', 'configuration_mode': 'proposed' if env_file or gateway_env_file else 'installed', 'live_probes_requested': probe, 'checks': checks, 'deployment_performed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--source-root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--env-file', type=Path)
    parser.add_argument('--gateway-env-file', type=Path)
    parser.add_argument('--probe', action='store_true', help='Bounded read-only loopback health and authenticated model/status requests.')
    args = parser.parse_args()
    report = check_runtime(args.project_root, args.source_root, args.node, env_file=args.env_file, gateway_env_file=args.gateway_env_file, probe=args.probe)
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'ready' else 1


if __name__ == '__main__':
    sys.exit(main())
