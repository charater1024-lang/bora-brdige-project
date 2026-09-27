# BORA Bridge 0.8.4 — P1/P2 submission hardening

Baseline: the running 0.8.3 production source tree. The release is prepared in
an isolated directory from that exact tree. User accounts, sessions, profiles,
conversations, consents, API credentials and live database rows are not replaced
by source deployment.

## P1 fixes

- Make the page shell the single session-request owner. A transient session
  failure preserves the last verified principal and exposes an explicit retry;
  a verified anonymous response still clears authenticated state.
- Give My Page a bounded error state and retry action instead of leaving it in
  an indefinite loading state. Failed sign-out attempts keep the current user
  visible and explain that the session was not cleared.
- Bound home and My Page session, sign-out, recommendation and finance-ledger
  requests to 12 seconds. Bound each public-dashboard attempt to 10 seconds.
  A real timeout becomes a retryable error while navigation, unmount and a
  superseding request remain silent cancellations.
- Abort superseded product-recommendation requests and require the response to
  match the latest request ID, so a slow older result cannot overwrite newer
  conditions.
- Retry transient public-dashboard failures only after 750 ms and 2 seconds,
  then expose a manual retry. Unmount and query changes cancel pending requests
  and retry timers.
- Exclude explicitly expired notices and elapsed event schedules from current or
  latest RAG answers. Prefer stated live application windows over unknown dates,
  while retaining labelled historical retrieval for explicit past queries.
- Deduplicate Bizinfo records across direct and data.go.kr sources using official
  announcement IDs, canonical detail URLs and title-period identity. Generic
  dataset links remain distinct.
- Keep the last valid catalogue on upstream failure, use bounded Bizinfo retry
  backoff, and apply the 730-day archive bound to every completed generation.
- Bind a quoted interest rate to the duration written in the same evidence row.
  A rate listed for 24 or 36 months can no longer validate a claim about a
  12-month product merely because both numbers occur in the same source.
- Query the financial-company provider by the latest available Seoul business
  date before paging. Reject providers that ignore the requested base date, so
  the first 2,000 rows of the provider's multi-million-row daily history cannot
  be presented as the current company catalogue. Retry at most two transient
  probe failures inside the declared 32-call source budget.
- Treat financial-company rows as point-in-time verification data. Rows older
  than 30 Seoul calendar days are excluded from the current UI, catalogue
  counts and RAG projection; a recent date-valid last-known-good snapshot is
  retained through an ordinary later provider failure.
- Make migration `0026_financial_company_snapshot_guard.sql` and its incremental
  dependency mandatory, ordered entries in the signed release plan. After the
  new application passes canonical health, run the installed read-only public
  catalogue verifier before restarting collection timers; a missing migration
  record or any stale financial-company RAG row fails the release and enters
  the existing source/dist recovery path.
- Provide a separately confirmed `--force-current-cycle` requeue mode for
  operational verification. It changes only selected, unreserved source-cycle
  eligibility inside one transaction and preserves quota, failures and all
  other source state. Force success is explicitly labelled
  `mode: force-current-cycle` while the default command keeps its original
  output contract. The README runbook fixes the canonical production database
  and runtime paths, requires both confirmation variables, validates source and
  reservation state, takes an online backup, and documents the subsequent
  upstream-call and quota effects.

## P2 improvements

- Add correct page-heading structure, stronger small-text contrast, roving
  keyboard tabs, and focus/scroll restoration after catalogue pagination.
- Support won/manwon goal input with grouping separators and one canonical won
  value. Preserve anonymous asset drafts in session storage and require an
  explicit import before writing them to an authenticated account.
- Make Bori guidance expose a retry after API failure, advance through the real
  recommendation queue, and report progress from that queue rather than a fixed
  decorative count.
- Expose the same account menu from public-information pages, including checked
  sign-out failure handling.
- Present the legal helper as a key-article summary based on official text. A
  local model may only prioritize complete server-owned excerpts; it cannot
  rewrite legal wording, omit blocks or make a case-specific legal decision.
- Disable file watching in the read-only RAG verifier so large backup trees do
  not exhaust filesystem watcher limits.
- Record the Linux boot ID in the runtime canary. `reboot_tested` becomes true
  only after a different boot ID is observed and remains auditable across later
  checks.
- Store a deterministic SHA-256 inventory of every production-bundle file in
  the release manifest, verify it before installation, and verify the installed
  bundle again before starting the web service.

## Verification boundary

The release requires the complete type, lint, unit, RAG, reliability and
production build suites in both the local workspace and the isolated Linux
release directory. It also requires public browser checks, a real host reboot,
post-reboot service readiness, database integrity and source/build provenance
checks. Third-party OAuth completion still requires an actual provider account;
Work24 remains disabled for the current individual operator. It may be enabled
only after enterprise membership, provider API-service approval and the issued
key's validity are all confirmed; KOSIS and MOEL information remain available
independently.
