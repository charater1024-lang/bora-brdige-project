# Page-performance coverage release v15

This release binds the v0.8.9 source after cache-only dashboard reads,
category-scoped count queries, single-pass youth facets, and the race-safe
overview request lifecycle. Evaluation expectations and scores are unchanged.

## Immutable inheritance

The generator verifies the sealed v14 predecessor receipt SHA-256
`11454c0ea01a3e4cd919053f2fb12d902982f7b76845a1c0aa2897fc69a48e7d`,
its manifest, suite hashes and provenance before inheriting the frozen cases.
All 600 case objects, including inputs, expected values, IDs, graders and source
references, remain identical in canonical JSON to v11, v12, v13 and v14. Only
each suite's top-level corpus ID changes; expected values are not recomputed.

The previous artifact directories and their generation, validation and replay
scripts remain unchanged. Their original seals bind their original source and
dependency locks. The inherited authorship record does not claim new case
authorship or independent expert review.

## Source binding and acceptance

Application and npm evaluation commands select
`bora-judge-coverage-2026-09-23-v15`. Generator 2.7 pins 125 source files and the
v0.8.9 dependency lock. The source bundle explicitly includes the changed
dashboard route, overview and mascot components, and performance/lifecycle
regression tests in addition to the existing evaluator sources.

- Actual validator and replay acceptance passed before the seal was written.
- Post-seal validation and replay with `--require-sealed` passed: 600 passed,
  0 failed, 0 errors; all six suite gates passed.
- Repeated replay was byte-identical, with zero observed fetch/time/randomness
  calls inside the declared instrumentation boundary.
- Evaluation and in-memory SQLite/D1 saved-history tests: 16 passed.

Manifest SHA-256:
`6a62d823cc549d0b646661bc2b53ce02e2d39b23575ede1b631e0057d0c9ba3f`.
Inherited definition SHA-256:
`b55787f2a5463c6a304ea6b03286be2b6b40d929a7cab3c221e1889ebb371d84`.
Unchanged replay-result SHA-256:
`5f16ac42e4ddfaaab0902cfc0b228201f4cda4332cc3e2c839a245b713b0f819`.

## History and evidence boundaries

The read-only registry includes v11/v12/v13/v14. Existing results retain their
original corpus IDs, hashes, scores and sealed/unsealed status when read or
exported. They cannot be mutated or treated as current v15 readiness results.
New runs use v15; no old record is relabeled.

Rolling back to an older binary can hide newer corpus records without deleting
them. Preserve original exports and backups, or use a rollback build with the
matching read-only history registry. Never replace a live database with an
older copy merely to roll application code back and lose newer user data.

The 600 deterministic cases do not measure page latency, production traffic,
external OAuth providers, or every live API. Catalogue-equivalence tests,
request-lifecycle tests, browser observations, and before/after timing checks
are separate evidence. Coverage still contributes zero to the unchanged
28-case deep score. These tests are neither an official competition score nor
independent financial, legal or security expert review.
