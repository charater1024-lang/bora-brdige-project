# Public source / production parity

The public repository is the real application source, not a reduced demo.
There is no private alternate implementation to restore after export. The same
source builds the web application, data collectors, gateway and operational
helpers. Secrets are supplied at runtime; they are never replaced with `***`
inside executable code. Public domain names and ordinary API endpoint names
are not secrets.

## What stays outside Git

| Source shared with every installation | Private installation inputs / persistent state |
| --- | --- |
| OAuth routes, account/session and finance storage code | Existing OAuth credentials, canonical origin and database |
| Administrator authorization policy | Verified `DEVELOPER_ADMIN_IDENTITIES` provider:subject list |
| Privacy/terms pages | `LEGAL_CONTACT_EMAIL` public contact setting |
| AI/RAG and official-data adapters | Existing API credentials, encryption key, provider on/off settings and indexed data |
| Local LLM gateway and token validator | Existing distinct inference/admin tokens, installed models and selected-model state |
| Service templates and renderer | Node/checkout/configuration paths, tunnel credentials and rendered units |

Preserve `.env.local`, `.env.scheduler`, `.env.public-api-proxy`, the gateway
`.env`, the existing `.wrangler` database/state, model state, and private service
configuration. Do not use `git clean`, reset the database, overwrite configuration
with `.env.example`, regenerate valid tokens, or run an indiscriminate
`rsync --delete` as part of a source update. Losing the encryption key makes
existing encrypted API credentials unreadable. A source ZIP intentionally does
not contain the data or secrets needed to impersonate the production service.

## Candidate validation without changing production

Use an isolated candidate directory with the same supported Node version and
lockfile. Install dependencies there with `npm ci`; do not install or update
the running service's dependencies for a validation run. Build and test:

```bash
npm run build
npm test
npm run test:parity
python3 -m unittest discover -s tests -p test_public_runtime_preflight.py
# Use a test environment containing the gateway requirements. Tests prevent
# sockets and model activation; never import a live app with its real state.
BORA_REQUIRE_GATEWAY_TESTS=1 python3 -m unittest discover -s tests -p 'test_local_llm*.py'
```

Prepare any proposed private configuration in a separate mode-0600 file on the
server. Keep the existing values; add the existing administrator's exact
provider subject and the existing verified public contact. Neither value needs
to be committed. The administrator identity is matched against existing account
records; there is no email-based privilege fallback.

From the candidate directory, run the non-mutating application preflight:

```bash
python3 deploy/verify-public-runtime.py \
  --source-root /absolute/path/to/candidate \
  --project-root /absolute/path/to/production \
  --node /absolute/path/to/existing/node \
  --env-file /absolute/path/to/private/proposed.env \
  --probe
```

Omit `--env-file` to inspect the installed `.env.local`; an optional
`--gateway-env-file` selects a proposed gateway configuration. Alternative
configuration arguments result in `configuration_mode: proposed`, not a claim
that installation has happened. The tool never installs settings, starts or
stops a service, loads a model, or runs SQL updates. It emits only check names,
booleans and fixed error codes, never credential or account values. SQLite is
opened read-only with query-only mode; SQLite may use its ordinary WAL shared
memory/locking coordination. It is not opened with `immutable=1`, which could
omit committed WAL contents.

This is the existing **Local-AI production profile**: canonical HTTPS OAuth,
registered administrator, valid public contact, existing encryption/scheduler
keys, matching loopback scheduler, exactly one local D1 database, exclusively
enabled Local AI, matching web/gateway credentials and an explicit safe Node
runtime. It rejects missing configuration before any deployment. Encrypted
database overrides are checked when present (using the existing `cryptography`
dependency); missing decryption support blocks validation rather than guessing.
An intentionally paid-AI-only/AI-disabled or remote-scheduler installation needs
a separately reviewed profile. This gate does not change feature switches.

`--probe` sends only bounded loopback GET requests: canonical web health,
authenticated model listing and authenticated model status. Redirects and
ambient HTTP proxies are disabled. Selected and loaded model IDs must match the
database's enabled local model. These probes do not prove OAuth browser round
trips, every external API, future reboot success, or an actual new-version
service cutover.

Render all intended units using the same explicit target root and Node path.
`install-user-units.sh --print` only prints; it does not install/reload/start.
Save rendered units in a private staging directory and validate them with
`systemd-analyze --user verify` before any future application. Configuration
paths honor the same validated `XDG_CONFIG_HOME` for reading and writing.
Install-time batch failures restore earlier unit files; service-manager changes
remain an explicit operator step.

## Controlled production cutover (separate authorization)

1. Capture the running source/build hashes, installed units, timer state and
   runtime paths. Take protected, verified backups of code/configuration and an
   online SQLite backup; never publish these backups.
2. Complete the isolated build/tests, all-unit validation and proposed-config
   preflight above. Keep the same existing Node, Python, DB and secret values.
3. Plan the source/build/unit/configuration update as one reviewed release.
   Pause the relevant writers/timers during the short cutover, preserving their
   original active/enabled states. Do not copy only a changed wrapper: include
   `deployment-paths.sh`, gateway `gateway_security.py`, and the complete source
   release with its matching build.
4. Apply private configuration and rendered units, perform a deliberate daemon
   reload and only necessary service restarts, then verify canonical web health,
   actual existing-admin access, normal login, saved finance data, authenticated
   gateway readiness, collection schedules and watchdog/autostart observations.
5. Restore the prior code/build/units/configuration if verification fails, and
   verify the restored service before declaring recovery. Preserve newly written
   user data; do not blindly restore an old full DB backup over a live database.

The old `apply-user-security.sh` is a historical staged dependency-swap tool,
not a general v0.8.7 deployment command. Its failure handling is tested, but it
does not orchestrate every modern timer or configuration migration. Other
dated one-off release scripts retain their original migration contracts. Do not
run them simply because they are present in the source release.

## Evaluation records and rollback

Known sealed v11/v12/v13/v14/v15/v16 coverage results remain readable/exportable with their
original corpus IDs, hashes, scores and sealed state. New runs use v17. Historic
results are read-only and are never relabeled as the current source release.

An older binary cannot know later coverage releases: for example, an unmodified
v0.8.10 binary cannot read new v17 records. Rolling back to an older binary may
hide newly created results (not delete them). Keep original
JSON/CSV exports and backups, or use a rollback build with the matching history
reader. This is an explicit rollback boundary, not permission to rewrite old
evaluation seals or discard newer user data. Existing schema-4 records retain
their prior behavior.
