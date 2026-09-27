# BORA Bridge 0.8.5 — final submission hardening

Baseline: BORA Bridge 0.8.4. The release keeps the production database and
private runtime configuration in place, builds in an isolated directory, and
installs only hash-listed source and production artifacts.

## Security and privacy

- OAuth consent can no longer be asserted through query parameters. A
  same-origin JSON POST accepting the exact current policy versions creates a
  one-time server transaction, PKCE verifier, and HttpOnly state cookie.
- Authenticated session lookup now assembles every selected column before its
  joins; an in-memory SQLite regression executes the exact query and verifies
  that the session expiry is returned.
- Session expiry, sign-out, and account changes cancel outstanding requests and
  remove cached account finance data from both the workbook and home summary.
- Unbound legacy local storage finance records are discarded instead of being
  offered to the next account on a shared device. Pre-login session drafts are
  imported only after being bound to the matching authenticated principal.
- Model-facing user history and public-provider fields are redacted or
  quarantined when they contain sensitive data or prompt-injection patterns.
- The exact dependency lock patches React/RSC, Vite, nanoid, and the `ws` and
  `undici` transitive packages that the local Worker runtime loads in service.

## Evidence and data truthfulness

- Public-item AI summaries reject unsupported numeric, date, eligibility, full
  subsidy, repayment-free, guaranteed, interest-free, and fee-free claims.
- Recent filters use official publication or provider-update dates, never local
  discovery or verification timestamps. Regional and nationwide counts remain
  separate.
- Youth, startup, finance, and Seoul commercial records receive conservative
  region, duplicate, encoding, quarter, address, and missing-data handling.
- The independent Seoul commercial snapshot remains available when notice
  freshness filters are applied; unavailable sales or footfall data is never
  replaced with a fabricated zero.

## User experience and operations

- Mobile guidance, legal disclosures, pagination focus, exchange precision,
  grouped money input, localized labels, timeouts, retry states, and session
  focus/visibility revalidation are covered by regression tests.
- The memory watchdog installs in active recovery mode with sustained
  thresholds, restart serialization, bounded attempts, and canonical health
  verification.
- The v8 judge coverage corpus contains 600 deterministic offline cases and is
  sealed to the final source and dependency hashes before release.

## Release gates

The release is accepted only after TypeScript, ESLint, all JavaScript and Python
tests, the production build, sealed 600-case validation/replay, isolated Linux
preflight, canonical health, public browser journeys, and service/timer checks
all pass. Provider OAuth completion is checked with real provider accounts; an
unapproved Work24 individual key remains truthfully unavailable rather than
being presented as a working integration.
