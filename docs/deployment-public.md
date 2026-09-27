# Portable user-service deployment

Tracked deployment files contain no deployment account name or private runtime
installation path. This is source portability, not an automatic migration:
existing services keep their installed unit files until an operator replaces
them. No service or database is changed merely by updating this checkout.

## Configuration

Before deploying v0.8.7 over an existing installation, configure the current
administrator's verified `provider:subject` in `DEVELOPER_ADMIN_IDENTITIES`
inside the private application environment file. Preserve the exact subject's
case and verify it against the authenticated account record. The old built-in
email exception has been removed; an empty allowlist grants no administrator
access. Set `LEGAL_CONTACT_EMAIL` to the existing verified public contact so
privacy/terms pages continue to show a working contact. Neither value belongs
in committed examples. Synchronize these settings before switching the app
bundle, then verify the existing administrator session after deployment.

The gateway now imports `gateway_security.py`; deploy it together with
`app.py`. Both existing inference and administration tokens must be distinct,
non-placeholder ASCII tokens of at least 32 characters. Preserve valid tokens;
if rotation is required, coordinate the protected web-app and gateway settings
before restarting either service.

Run deployment commands as the existing application service user. The shell
helpers discover the checkout from their own location. When a release script
is copied to a staging directory, explicitly export `BORA_PROJECT_ROOT` to the
real application checkout before invoking it.

| Variable | Default / constraint |
| --- | --- |
| `BORA_PROJECT_ROOT` | Physical parent of the script's `deploy` directory; must contain `package.json` and `deploy`, with the safe ASCII path syntax described below. |
| `BORA_NODE_BIN` | `node` on the invoking shell's `PATH`, resolved to an absolute executable. |
| `BORA_GIT_BIN` | `git` on `PATH`; only resolved by release helpers that use Git. |
| `BORA_SQLITE_BIN` | `sqlite3` on `PATH`; only resolved by helpers that use SQLite. |
| `BORA_D1_FILE` | Exactly one non-metadata `.sqlite` in the checkout's local D1 directory. An explicit selection must remain directly in that directory; symlinks are rejected. |
| `BORA_LOCAL_LLM_PYTHON` | `python3` on `PATH`, used when the dedicated gateway virtual environment must be created. |
| `BORA_LOCAL_LLM_RUNTIME_ROOT` | `$HOME/.local/share/bora-bridge`; the LLM installer permits only that directory or its descendants. |

Set the executable variables explicitly when the existing installation uses a
runtime outside the service manager's default `PATH`. Do not guess a new Node
version or replace a working runtime as part of publication cleanup. These
variables are operator configuration, never request parameters. Do not commit
host-specific exports or generated units.

The serving sandbox adds a stricter check: its project root must match its own
physical checkout. `BORA_PROJECT_ROOT` cannot redirect its writable mounts to
another checkout. The persistent state, probe state, and generated runtime
configuration retain their exact path allowlists. Credential masking resolves
the service account's actual home from the account database, not a supplied
`HOME` value.

Install the checkout and Node runtime outside masked private directories such
as `.config`, `.cache`, `.ssh`, and `.codex`. The sandbox refuses to run if a
credential mask would hide the selected executable or checkout; it never
removes a mask to accommodate a runtime. A rendered unit alone does not verify
Bubblewrap/runtime compatibility.

## Render and install selected units

The public `.service` sources use `%h/Project/BORA-Bridge-Finance-AI` as a portable
example layout and `/usr/bin/env node` as a generic executable. Prefer the
renderer over copying them directly: it pins the selected checkout and Node
executable, including the environment used by sandbox startup and shutdown.
Linux installation paths must use ASCII letters, digits, `/`, `.`, `_`, or `-`;
whitespace and systemd metacharacters fail closed.

```bash
cd /absolute/path/to/BORA-Bridge-Finance-AI
export BORA_PROJECT_ROOT="$(pwd -P)"
export BORA_NODE_BIN="$(command -v node)" # or the existing runtime's absolute path

# Read-only preview: no files, service manager, or runtime state are changed.
bash deploy/install-user-units.sh --print bora-bridge.service
```

For an existing deployment, first save the installed units privately, render
each proposed unit to a private staging directory, compare the changes, and
run `systemd-analyze --user verify` against those rendered files. Resolve any
missing dependency or executable before applying them. Preserve the current
runtime and deployment paths during the first update. A successful local
syntax check is not evidence of live Linux readiness.

```bash
# Explicitly select only the units being updated, after backup and review.
bash deploy/install-user-units.sh bora-bridge.service
# This installs files only. It does NOT reload, enable, start, or restart units.
```

Schedule `systemctl --user daemon-reload` and any necessary restart separately,
with health checks and a rollback copy available. Existing dedicated health,
memory-watchdog, LLM, and release installers retain their documented activation
behavior; they now render paths before installation. In particular, the
transactional runtime-stability release verifies the rendered units and keeps
the original templates separately for byte-identical source rollback.

## Remaining platform assumptions

This deployment targets a Linux user service manager with systemd, GNU command
line tools, Bubblewrap at `/usr/bin/bwrap`, and a loopback-bound application.
Cloudflared remains at `%h/.local/bin/cloudflared` with its private configuration
under `%h/.cloudflared`; Ollama remains at `/usr/local/bin/ollama`. Those are
documented platform defaults, not discovered binaries. Adapt and verify these
unit defaults deliberately if the host uses another layout. Unit environment
files for watchdog/restart configuration use `%h/.config/bora-bridge`.

The application domain, service names, local D1 layout, ports, and memory limits
remain project defaults. Publication cleanup does not turn historical release
scripts into a general-purpose deployment platform. Do not run old one-off
release helpers without reviewing their migration and rollback contract.

All example secret values must stay empty. Populate private environment files
locally, restrict them to the service account, and never commit rendered units,
database copies, runtime configuration, or service logs.

For the same-source production contract, read-only preflight, prior evaluation
compatibility, and controlled rollout/rollback boundaries, see
[Public source / production parity](public-runtime-parity.md).

## Checks

```bash
for script in deploy/*.sh; do bash -n "$script" || exit; done
bash deploy/install-user-units.sh --print bora-bridge.service
# On the target Linux host, verify rendered units before a controlled restart.
```
