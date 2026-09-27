# BORA Bridge 0.8.3 — session, catalogue and restart safety

Baseline: the running 0.8.2 production source tree. The release is prepared in
an isolated directory from that exact tree and overlays only the files listed in
`production-fixes-0.8.3-files.txt`. User accounts, sessions, profiles,
conversations, consents, API credentials and live database rows are not replaced
by source deployment.

## Changes

- Bind every delayed session, AI, history, finance and consent response to the
  authenticated member and principal generation that started it. Logout,
  account switches and authentication failures abort old work and clear private
  client state. The home control centre now follows the same authoritative
  session instead of retaining a second stale identity.
- Increase per-source catalogue capacity so completed K-Startup and DART
  backfills are not silently reduced to a dashboard-sized sample. A completed
  generation is accepted only after contiguous page, page-size, provider-total
  and unique-item checks pass.
- Publish catalogue replacements atomically through staged generations. Readers
  see either the previous complete generation or the new complete generation,
  never a mixture. Interrupted generations are discarded on retry without
  deleting the last published catalogue.
- Preserve expired records in completed catalogues while keeping the ordinary
  active view focused on current items. The explicit all/expired views can
  retrieve retained records. Category responses remain bounded while their
  summary reports the real stored total.
- Keep provider paging limits and local retention limits separately observable.
  A source is not labelled complete when an upstream API window prevented a
  complete retrieval.
- Make the web service recover independently while Ollama and the local gateway
  start. Runtime installation requires persistent user services and login
  lingering. The release canary verifies enabled and active units, canonical web
  health, a ready selected local model and restart deltas; it does not claim that
  an actual host reboot was performed.
- Version the release as 0.8.3 and include the additive catalogue-generation
  migration in release preparation and verification.

## Verification boundary

- Local RAG phase: 121 passed, one POSIX-only test skipped on Windows.
- Local reliability phase: 52 passed.
- Local production-fix phase: 52 passed, one POSIX-only test skipped on Windows.
- The full production build and core test phase are also required in the
  isolated Linux release directory before installation. Linux runs the POSIX
  canary behaviour test that Windows cannot execute.
- Real host reboot, third-party OAuth completion and Work24 live authorization
  are separate operational checks. This patch neither reboots the server nor
  sends a stored Work24 key without explicit approval.

Database migration `0025_public_catalog_generations.sql` is additive. The
deployment makes a private online SQLite backup, validates it, pauses database
writers briefly, and never restores that backup over post-release user writes
during automatic source rollback.
