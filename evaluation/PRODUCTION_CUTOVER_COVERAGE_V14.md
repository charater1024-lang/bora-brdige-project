# Production-cutover security coverage release v14

This release binds the v0.8.8 source after request-body bounds and OAuth-start
rate-limit changes. It does not change evaluation expectations or scoring to
accommodate the new code.

## Immutable inheritance

The generator verifies the sealed v13 predecessor receipt SHA-256
`7e9c9072cf5bc90dbb17e2bd359d5d0e997312fea04673566e64c0a6438e9351`,
its manifest, suite hashes and provenance before inheriting its frozen cases.
All 600 case objects, including inputs, expected values, IDs, graders and source
references, remain identical in canonical JSON to v11, v12 and v13. Only each
suite's top-level corpus ID changes. Expected outcomes are not recomputed.

The v11/v12/v13 artifact directories and their generator, validator and replay
scripts remain unchanged. Historical pins describe their original releases;
historical replay requires matching source and dependency lock. The inherited
authorship record is not a claim of new authorship or independent expert review.

## Source binding and actual acceptance

Application and npm evaluation commands select
`bora-judge-coverage-2026-09-23-v14`. Generator 2.6 pins 118 evaluator-source files
and the v0.8.8 dependency lock. A release receipt was written only after actual
validator and offline-replay acceptance processes passed.

- Post-seal validation and replay with `--require-sealed`: pass.
- Six suites of 100 cases: 600 passed, 0 failed, 0 errors; all gates pass.
- Repeated replay: byte-identical; observed fetch/time/randomness calls are zero
  within the declared instrumentation boundary.
- Canonical 28-case plus 600-case replay: 100/100 deep score and 600/600 coverage.
- Evaluation and in-memory SQLite/D1 saved-history tests: 16 passed, 0 failed.

Manifest SHA-256:
`96d274085e28f3cbadf5136ac3ea5779b383e0813618776d3af52d8dc89ec133`.
Inherited definition SHA-256:
`b55787f2a5463c6a304ea6b03286be2b6b40d929a7cab3c221e1889ebb371d84`.
Unchanged replay-result SHA-256:
`5f16ac42e4ddfaaab0902cfc0b228201f4cda4332cc3e2c839a245b713b0f819`.

## History and rollout boundaries

The read-only registry now includes v11/v12/v13. Stored results retain their
original corpus, hashes, scores and sealed/unsealed status when read or exported.
They cannot be mutated or treated as current v14 readiness results. New runs use
v14; old records are never relabeled.

Rollback to an older unpatched application can hide newer corpus records without
deleting them. Preserve database backups and original exports, or use a rollback
build with the read-only compatibility registry. Do not replace a live database
with an older copy just to roll application code back and lose newer user data.

These deterministic tests do not exercise production traffic, external OAuth
providers or every live API. Request-boundary and OAuth limiter tests, deployment
preflight, browser checks, and controlled cutover/rollback checks are separate
evidence. This corpus is neither an official competition score nor independent
financial, legal or security expert review.
