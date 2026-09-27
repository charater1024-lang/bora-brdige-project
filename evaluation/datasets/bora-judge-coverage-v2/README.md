# BORA Judge Coverage Corpus v2

This directory contains 600 synthetic, deterministic regression cases: 100
cases in each of six BORA Bridge evaluation suites. Version 2 updates the
financial-safety expectations for the explainable phishing rules introduced on
2026-08-11. It is a draft until `release.json` exists. Once that seal exists,
the generator refuses every overwrite (including `--replace-draft`); changes
require a new corpus ID and directory.

The historical coverage-v1 directory is preserved byte-for-byte. Schema-v4
sessions remain stored and countable, but the current schema-v5 UI/API does not
open, export, or reinterpret them. Recovery requires the prior tagged release
and its original artifact registry or backup.

## GPT-5.6 Sol disclosure

GPT-5.6 Sol in the current Codex desktop session supported the authorship and
code-grounded review of the synthetic case families. Model information is in
the official [GPT-5.6 Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

This authorship statement is separate from runtime execution:

- checked-in generator model/API calls: **0**;
- scored and coverage replay model/API calls: **0**;
- replay `fetch` calls observed from evaluator module load through execution: **0**;
- instrumented case-execution time/random calls: **0** (`Date`,
  `performance.now`, `Math.random`, and Web Crypto random APIs);
- independent expert review: **not_performed**.

The replay does not claim instrumentation of time/random calls during module
initialization or direct native HTTP clients. Those limits are recorded in
`provenance.json`; source/lock hashes and byte-identical double replay provide
additional drift evidence but are not a proof over uninstrumented APIs.

Expected values are code-grounded regression labels or explicit stored policy
contracts. They are not an official hackathon score, an external financial
benchmark, an accuracy claim on real scam traffic, or an expert certification.

## Verify a released corpus

From the repository root:

```text
node scripts/validate-judge-coverage-corpus.mjs --require-sealed
node scripts/replay-judge-coverage-corpus.mjs --require-sealed
```

The default `npm run eval:judge:coverage` and
`npm run eval:judge:validate-coverage` commands also require the seal. Only the
explicit `:draft` variants permit pre-seal acceptance work.

Validation requires exactly 600 unique IDs and semantic definitions, matching
suite/generator/manifest hashes, the exact `package-lock.json` SHA-256, every
file in the canonical evaluator source bundle (`package.json`, the complete
`lib/` runtime tree, coverage runner files, and declared evidence paths), and
the release seal. Replay verifies those pins before loading evaluator code,
executes all cases twice with the declared network, wall-clock, and randomness
traps enabled, and requires byte-identical results.

Source and lockfile hashes canonicalize valid UTF-8 text to LF before SHA-256,
avoiding Windows/Ubuntu checkout line-ending differences. Emitted corpus JSON
artifacts remain byte-hashed.

## Author and seal a new draft

Only an unsealed directory may be regenerated. A pre-existing draft requires
the explicit `--replace-draft` flag so regeneration cannot happen silently.
After every evaluator and evidence source is final, run this sequence once:

```text
node scripts/generate-judge-coverage-corpus.mjs --replace-draft
node scripts/validate-judge-coverage-corpus.mjs
node scripts/replay-judge-coverage-corpus.mjs
node scripts/generate-judge-coverage-corpus.mjs --seal
node scripts/validate-judge-coverage-corpus.mjs --require-sealed
node scripts/replay-judge-coverage-corpus.mjs --require-sealed
```

`--seal` independently reruns validation and the 600-case replay, records their
pass receipts and result SHA-256, and only then creates `release.json` with an
exclusive write. The explicit pre-seal commands remain useful because they show
failures before the irreversible seal step.

For a brand-new empty version directory, omit `--replace-draft` on the first
command. Never delete a seal to revise a released corpus.

The full result remains ephemeral. D1 stores only the compact suite summary,
two-bit status vector, whole-result SHA-256, and at most 24 failure details.
JSON exports carry that compact object; CSV exports add one coverage-summary
row, six suite rows, and the same bounded failure rows. Neither format claims
to embed 600 result rows. Exhaustive definitions live in the six suite files;
exact results can be reconstructed only by the offline replay in a preserved
repository release/archive whose dependency and source hashes match the seal.
The hashes detect drift; they do not recreate missing historical source files.
