# BORA Judge Coverage Corpus v1

This immutable corpus contains 600 synthetic, deterministic coverage cases:
100 cases in each of the six BORA Bridge evaluation suites. It supplements the
existing v2 28-case, 100-point deep evaluation; it contributes no additional
score and does not reinterpret historical sessions.

## GPT-5.6 Sol disclosure

GPT-5.6 Sol in the current Codex desktop session supported the authorship and
code-grounded review of the synthetic case families. Model information is
available in the official [GPT-5.6 Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

That authorship statement is distinct from runtime execution:

- checked-in generator model/API calls: **0**;
- scored/coverage replay model/API calls: **0**;
- replay external network calls: **0**;
- replay wall-clock and random inputs: **0**;
- independent expert review: **not_performed**.

The fixed expected values are code-grounded regression labels or explicit
stored policy contracts. They are not an official hackathon score, an external
financial benchmark, or an expert certification.

## Reproduce

From the repository root:

```text
node scripts/generate-judge-coverage-corpus.mjs
node scripts/validate-judge-coverage-corpus.mjs
node scripts/replay-judge-coverage-corpus.mjs
```

The generator uses fixed enumeration only. Validation requires exactly 600
unique IDs, 600 unique semantic definitions, existing evidence paths, matching
SHA-256 hashes, and the declared privacy/runtime boundaries. Replay executes all
cases twice with network, wall-clock, and randomness traps enabled and requires
byte-identical results.

## Compact session contract

`lib/judge-coverage-corpus.ts` exports the runner and compact result types. The
full 600-case result is ephemeral/exportable; D1 should store only suite
summaries, a two-bit status vector, the whole-result SHA-256, and at most 24
bounded failure details. The current compact all-pass result is well below the
81,920-character application budget.
