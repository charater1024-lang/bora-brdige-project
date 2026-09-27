# BORA Bridge 0.8.2 — production functional fixes

Baseline: the running 0.8.1 source tree on 2026-09-01, including its existing
uncommitted RAG/UX changes. The old GitHub commit is not used as the release
contents. No user profile, account, conversation, API credential or consent
setting is replaced by this patch.

## Changes

- Fix nationwide commercial search's quota-day contract: both the producer and
  reservation validator use the existing compact KST ledger day. Invalid days
  remain rejected. Quota/setup failures no longer consume a user's search
  allowance; unused reservations are released when user limits reject a call.
- Return the same full-catalogue counts from ordinary home loads and login
  refreshes. Ignore superseded UI responses. Personalization remains opt-in;
  opted-out users can still browse the neutral youth-policy catalogue.
- Keep a single login dialog across menu changes and consume each open request
  once. Closing the dialog no longer leaves a pending open instruction.
- Cancel and invalidate outdated law guidance/summary requests on topic or
  locale changes and unmount. Even a transport that ignores abort cannot attach
  an old topic's summary or late failure to the current law. Stale approval
  callbacks cannot initiate work for a topic that is no longer selected.
- Compute startup region facets, text search and pagination on the complete
  announcement catalogue. Nationwide records do not inflate regional counts.
  Commercial boundaries/analytics remain available through their existing
  tools and are not counted as startup announcements.
- Separate youth publication dates from explicit source modification dates;
  preserve bounded raw date provenance. Quarantine invalid/future metadata
  without guessing timezone corrections. Parse date-only values in KST and
  exclude future anchors from recent filters and sorting. Public-only durable
  repairs remain backed up, idempotent and search-index aware.
- Improve intent-specific RAG evidence for deposit-versus-savings concepts and
  the official student-loan information route. Preserve the original catalogue
  paths for actual rate requests and local support policies. Recognize bounded
  paragraph-end and exact-URL citations without allowing unsupported numeric
  claims or borrowing a different paragraph's source.

## Law excerpts and quality preference

The previous shared free-form AI summaries are not reused. Current official
excerpts are the default; old source/prompt/model cache identities cannot hit.
This does not make a legal correctness guarantee about a user's situation.

For a ready local non-billable model, one bounded, rate-limited request may
propose the order of complete server-owned excerpt IDs. It cannot submit new
prose, omit a block or alter a number, condition, exception or claimant. The
candidate is used only if its consumer-relevance ordering score is strictly
higher than the original ordering. This is an **ordering heuristic**, not a
semantic-accuracy or readability proof and not a freely rewritten AI summary.
The UI distinguishes AI-ordered original excerpts from the default excerpts.

Shared results are keyed by official-source fingerprint, locale, model and
rubric. Lease-protected immutable ready entries prevent concurrent lower-score
requests from replacing the selected result. Failure/low-score outcomes are
also cached to avoid repeated generation. Model or source changes invalidate
that evaluation. No additional paid model is called automatically.

The official student-loan navigation reference used by the static RAG route is
[한국장학재단 학자금대출 한눈에보기](https://www.kosaf.go.kr/ko/tuition.do?pg=tuition_main),
checked on 2026-09-01. This reference supplies a route to official information,
not a claimed current interest-rate value.

## Verification and deployment

- Targeted integrated tests: 66 passed locally, including real production quota
  functions/SQL on isolated SQLite, route fixtures, catalog pagination and safe
  cached-date reading. These are not live upstream authorization tests.
- TypeScript and ESLint on changed production sources: passed locally.
- Full isolated server build: passed, including the final law-UI race fix.
  Test phases: core 452/452, RAG 122/122, reliability 52/52, production fixes
  33/33 (659 successful test executions;
  some UI tests intentionally run in more than one phase). No tests skipped to
  make the release pass. Real SSR buttons, rather than hidden text, resolve the
  home-launcher regression found during the full run.
- Public-only migration rehearsal: 85,893 stored item copies retained their
  membership digest; 30,419 RAG documents retained consistent projections.
  2,749 youth records received date provenance/normalization, not 2,749 proven
  future-date errors. A second repair needed zero changes. SQLite and FTS
  integrity checks passed. Rehearsal time was approximately 24.3 seconds under
  a CPU limit; these are not live search latency measurements.
- Post-deployment browser checks are separate from the isolated tests. The
  currently available browser session is anonymous; signed-in-only flows need
  the user to sign in again before their live verification can be completed.
- Deployment uses a separately seeded build, a hashed allowlist and full source
  baseline checks, private database/code backups, a brief service restart and
  restoration of existing timer states. Automatic code rollback never restores
  a live user database over newer writes.
- Existing Work24 authorization restrictions remain unchanged; no stored key
  is transmitted, tested or re-enabled as part of this patch.

Minimum Node version is 22.16, required by the repair tool's SQLite online backup.
