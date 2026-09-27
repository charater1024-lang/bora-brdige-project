# BORA Bridge 600-case automatic evaluation design

## Decision

The six existing suites can be expanded to 100 coverage cases each, but the
current session representation must not be copied 1:1. The selected design is a
separate 600-case deterministic synthetic corpus. The existing v2 28-case,
100-point deep evaluation remains the only score; coverage contributes zero
points and reports its own six suite gates. Neither scored path calls a model;
coverage replay observes zero `fetch` calls within its declared measurement
boundary.

This is a versioned companion artifact, not a reinterpretation or replacement
of the 28-case deep dataset. A coverage directory is a replaceable draft until
its `release.json` seal is created. After sealing, the generator refuses to
write that directory; a changed corpus requires a new corpus ID and directory.
The historical coverage-v1 directory remains byte-for-byte unchanged.

## Measured storage constraint

Run from the repository root:

```text
node scripts/audit-judge-600-scale.mjs
```

The audit measured the current 28-case sealed-session shape at 42,270 JSON
characters (44,924 UTF-8 bytes). Repeating that representation to 100 cases in
each of six suites projects 853,813 JSON characters (887,446 UTF-8 bytes).
`judge_evaluation_sessions.session_json` accepts at most 131,072 characters, so
the naive design reaches 651% of the application limit and cannot be deployed.

The size problem is caused by storing the full case catalog, expected values,
actual values, assertions, and evidence twice: once in `definitions` and once in
`automaticRun.cases`.

## Suite composition

Every record must have a unique semantic purpose. ID-only copies of the same
input and expected output are prohibited.

| Suite | Existing points | Target cases | Proposed coverage |
| --- | ---: | ---: | --- |
| `financial-correctness` | 18 | 100 | 30 asset/cash-flow summaries, 20 normalization boundaries, 30 settlement budgets, 20 won/manwon conversions |
| `evidence-grounding` | 15 | 100 | 56 multilingual knowledge retrieval queries, 36 financial-law intents, 8 unknown/ambiguous abstention cases |
| `financial-safety` | 24 | 100 | 50 allowlisted triage combinations across three domains, 50 phishing cases across four locales and benign/high-risk/adversarial classes |
| `privacy-consent` | 24 | 100 | 30 required-consent combinations, 30 context-preference allowlist/type cases, 40 PII redaction and prompt-injection cases |
| `stored-api-contract` | 8 | 100 | 20 fixtures each for health, public data, phishing, judge-session, and request-security contracts |
| `reproducibility` | 11 | 100 | 25 fixtures each for artifact integrity, runner boundaries, compact export, and evidence/claim boundaries |

Stored API cases are fixed normalized fixtures. They do not contact a deployed
URL, public-data provider, or AI provider. Operational diagnostics remain a
separate, explicitly triggered, non-scored run.

## Deterministic generation and provenance

Use six separately reviewable suite artifacts and one root manifest:

```text
evaluation/datasets/bora-judge-coverage-v9/manifest.json
evaluation/datasets/bora-judge-coverage-v9/financial-correctness.json
evaluation/datasets/bora-judge-coverage-v9/evidence-grounding.json
evaluation/datasets/bora-judge-coverage-v9/financial-safety.json
evaluation/datasets/bora-judge-coverage-v9/privacy-consent.json
evaluation/datasets/bora-judge-coverage-v9/stored-api-contract.json
evaluation/datasets/bora-judge-coverage-v9/reproducibility.json
evaluation/datasets/bora-judge-coverage-v9/provenance.json
evaluation/datasets/bora-judge-coverage-v9/integrity.json
evaluation/datasets/bora-judge-coverage-v9/release.json
```

The generator must have a fixed version and seed and must sort cases by suite
and ID before writing. It must not use `Date.now`, `Math.random`, `fetch`, or a
model/API call. Expected values must be frozen in the artifacts. Every case
records one of these oracle strategies:

- `code-grounded-arithmetic-snapshot`: expected values frozen from deterministic finance functions;
- `reviewed-label`: GPT-5.6 Sol-authored synthetic language example with a frozen label;
- `policy-contract`: expected result derived from an explicit versioned policy boundary;
- `snapshot-assertion`: JSON-pointer/operator assertion against a stored normalized response;
- `structure-contract`: assertion against versioned submission/build/export metadata.

Provenance must truthfully state that GPT-5.6 Sol in the current Codex workflow
supported synthetic fixture authoring and code-grounded review, that runtime
model use is false, and that independent expert review is `not_performed` until
such a review actually occurs. Code-derived regression labels are not an
independent financial-quality benchmark and must not be described as one.
The model reference is the official OpenAI documentation:
https://developers.openai.com/api/docs/models/gpt-5.6-sol.

The root manifest pins all six raw suite SHA-256 values, the provenance and
generator SHA-256 values, the case-order and definition SHA-256 values,
`package-lock.json`, and a canonical bundle containing `package.json`, the full
`lib/` runtime tree, required coverage runner files, and every declared case
evidence source path with its SHA-256. No source-commit claim is made.
`integrity.json` pins the root
manifest. The final `release.json` pins the manifest, integrity record,
definition/order hashes, dependency lock, and evaluator source bundle. Normal
generation refuses an existing draft unless `--replace-draft` is explicit and
always refuses a sealed directory.

Generation and sealing share an exclusive `.generation.lock`. The seal command
reruns validation and the 600-case replay itself, records their pass receipts
and result SHA-256, then creates `release.json` with create-only semantics.

Text-source and dependency-lock hashes use canonical UTF-8 with LF line endings
so the same Git content verifies on Windows and Ubuntu. Suite, manifest,
provenance, integrity, and release JSON hashes cover their emitted bytes.

## Score isolation

Coverage cases have no `weight` and contribute zero points. They report exact
pass/fail/error counts and a suite gate. The existing deep evaluation preserves
its 18/15/24/24/8/11 allocation, 28 cases, and 100-point maximum without any
floating-point normalization or historical-session migration. Diagnostics also
remain non-scored.

## Critical gates

Each coverage suite has an explicit critical subset and requires every listed
result to pass. Preserve the semantic anchors covered by every current v2
required case, then add only high-risk or boundary variants whose failure should
block the coverage suite gate.

Recommended critical coverage is:

- financial boundaries: zero, negative, cap, over-budget, and conversion limits;
- evidence grounding: emergency-response, law-topic, source-presence, and abstention boundaries;
- financial scam safety: all high-risk/adversarial transfer, credential, remote-control, and impersonation variants;
- privacy/consent: missing/wrong consent, unexpected fields, PII leakage, and injection variants;
- stored API contracts: access control, content type, response status, disclosure, source URL/date, and mutation guards;
- reproducibility: every artifact hash, case order, zero-call boundary, export schema, and evidence-manifest invariant.

Coverage is `allPassed` only when all 600 results are present and pass, all six
critical suite gates pass, artifact and result hashes match, and the coverage
runner observes zero model calls and zero instrumented `fetch`/time/random calls.
This status is displayed beside the v2 deep score and never changes the deep
score itself.

## Compact session schema

The versioned corpus is the source of definitions and expected values. Do not
copy 600 definitions into every D1 row. An optional `coverageRun` extension on
the existing session stores:

- corpus/manifest/definition and case-order SHA-256 values;
- suite pass/fail/error counts and critical gate results;
- a two-bit status vector in canonical dataset order;
- a canonical result SHA-256;
- bounded details for failed/error cases only, with an explicit omitted count;
- corpus authorship/claim boundaries and the outer session's timestamps,
  reviewer identity, notes, and seal state.

When requested, the outer session stores a separate scored-zero diagnostic
snapshot; it is not embedded in or scored by `coverageRun`.

The audit's minimal all-pass projection is 1,706 characters. Set a stricter
application budget such as 80 KiB to preserve headroom for diagnostics and
failure evidence. Reject oversized sessions before D1 writes.

The current implementation deliberately does not materialize 600 result rows in
each session export. Exact definitions remain in the six sealed suite artifacts.
The offline runner can reproduce a result only from a repository release/archive
whose dependency and source hashes still match the seal; hashes detect drift but
cannot reconstruct missing historical source by themselves. Store bounded
failure details in the sealed session so a mismatch after a future deploy remains
explainable. Use SHA-256 for artifact/result integrity; FNV-1a-32 may remain only
as a clearly labelled non-cryptographic quick replay fingerprint.

If result reconstruction across releases cannot be guaranteed, use a separate
normalized D1 case-result table instead. Do not raise the single JSON limit and
store an approximately 0.9 MiB blob per session.

## API, UI, and export behavior

- The session API and JSON export include the compact coverage result, not a
  duplicate 600-case catalog.
- The browser displays one coverage summary, six suite summaries, and bounded
  failed/error details; it does not claim a paginated 600-row result viewer.
- CSV emits one coverage summary row, six suite rows, and at most 24 bounded
  failure rows. JSON and CSV are therefore compact summaries, not exhaustive
  600-row exports.
- The PDF is a judge-readable score/gate/provenance report with the same bounded
  failure evidence. Exhaustive result recovery additionally requires the matching
  tagged repository release or a preserved evaluator-source archive.
- Sealed exports contain suite counts, the recorded manifest/definition/order
  and result hashes, zero-score disclosure, model/runtime-call disclosure,
  limitations, and independent expert review status. Dependency-lock and source
  bundle pins remain in the sealed corpus manifest and release record.

## Required generator and runtime checks

Release acceptance must fail unless all checks pass:

1. exactly six suites, exactly 100 cases per suite, exactly 600 unique IDs;
2. no duplicate canonical `(adapter, input, expected, grader)` definitions;
3. all case source references exist and every suite has a non-empty critical subset;
4. coverage score contribution is exactly zero and the v2 100-point score is unchanged;
5. declared risk-class coverage is satisfied and every case is synthetic;
6. no personal data, live malicious URL, secret, or live API response is stored;
7. all raw SHA-256, generator, case-order, definition, dependency-lock, and evaluator-source-bundle pins match;
8. two coverage runs are byte-identical and observe zero model calls plus zero
   calls to the declared `fetch`, time, and random traps; uninstrumented boundaries
   remain disclosed in provenance;
9. 600/600 cases pass and all critical gates pass;
10. compact sealed-session JSON remains below the chosen 80 KiB safety budget;
11. JSON/CSV/PDF expose one compact summary, six suite summaries, and no more than 24 failure details; totals match the replay;
12. the 28-case deep-score fields remain unchanged and are not reinterpreted by the coverage corpus.

## Rollout and rollback

Deploy additively with immutable dataset and session versions:

1. keep coverage-v1, coverage-v2, and coverage-v3 sealed releases unchanged, then
   commit the current-source coverage-v9 artifacts, runner, and tests; preserve every
   release commit with a tag or source archive;
2. run the 600-case replay and compact-session/export tests on the Ubuntu host;
3. create new evaluations as schema-v7 sessions; schema-v4 through schema-v6 rows
   remain stored and countable but the current UI/API does not open, export, or
   reinterpret them. Recover an older export only with its prior tagged release
   and original artifact registry/backup;
4. complete an authenticated developer-evaluation smoke test and verify D1 writes and exports;
5. rollback by restoring the previous application release without rewriting stored sessions.

Never delete coverage rows or artifacts during rollback. The v2 deep evaluation
continues to work independently while coverage is disabled or temporarily
unavailable.
