# Public-runtime compatibility coverage release v13

This release updates source and provenance pins for v0.8.7, including the
historical evaluation-session reader. It does **not** change the 600 evaluation
cases, expected outcomes, suite gates, or scoring rules.

## Immutable inheritance

The generator verifies the sealed v12 predecessor receipt SHA-256
`54c454c89736cd7e960add0f9248c6ad6827f3f619b947fdd88280f8fbb99ff9`,
its manifest, suite hashes and provenance before copying the frozen case objects.
All 600 case objects (IDs, inputs, expected values, graders and source references)
are byte-identical in canonical JSON to both v12 and v11. Only each suite's
top-level corpus ID changes. Expected outcomes are never recomputed.

The v11 and v12 artifact directories and their generator, validator and replay
scripts remain unchanged. Their pins describe their own source releases and must
not be rewritten to match this release. Historical replay requires the matching
historical source and dependency lock.

The inherited authorship record still describes the original synthetic case
authorship, not new authorship or independent review in this revision.

## Source binding and actual acceptance

The application and npm evaluation commands now select
`bora-judge-coverage-2026-09-23-v13`. Its manifest pins 116 evaluator-source files
and the v0.8.7 dependency lock. The new history registry is included in that source
inventory. The generator writes a sealed receipt only after successful validator
and offline replay processes; it refuses to overwrite a sealed release.

The actual acceptance results were:

- Post-seal validator and replay with `--require-sealed`: pass.
- Six suites of 100: 600 passed, 0 failed, 0 errors; all suite gates pass.
- Repeated replay: byte-identical; observed fetch/time/randomness calls are zero
  within the existing declared instrumentation boundary.
- Canonical 28-case plus 600-case replay: 100/100 deep score, 600/600 coverage.
- Existing evaluation tests plus actual in-memory SQLite/D1 history tests:
  16 passed, 0 failed.

The 600-case definition SHA-256 remains
`b55787f2a5463c6a304ea6b03286be2b6b40d929a7cab3c221e1889ebb371d84`.
Its result SHA-256 remains
`5f16ac42e4ddfaaab0902cfc0b228201f4cda4332cc3e2c839a245b713b0f819`.
The 600 cases contribute zero points; the separate 28-case maximum remains 100.

## Saved history and rollback boundary

Known v11/v12 results remain readable and exportable with their original corpus,
hashes, score and sealed/unsealed state. They are not treated as current v13
readiness results and cannot be modified or sealed by the current evaluator.
New evaluations use v13. Older schema-4 records retain their existing read path;
they are not reinterpreted as the current 100-point evaluation.

An unpatched v0.8.5 rollback still does not understand later v12/v13 results.
Back up and export new records before rollback, or use a rollback build with
the read-only compatibility registry. Never relabel old records or overwrite
the entire live database with an older copy merely to change application code.

These results are deterministic regression checks, not official competition
scores, independent expert review, or a claim that live production configuration,
external APIs and browser flows were all exercised by this offline corpus.
