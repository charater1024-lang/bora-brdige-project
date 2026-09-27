# Public-source coverage release v12

This is a **publication-source/provenance revision**, not a new set of evaluation
semantics. The privacy hardening changed authentication source, package metadata
and the source inventory. Those intentional changes invalidated v11's current-
source checks; they did not justify changing expected test outcomes.

The sealed v11 directory and its generator, validator and replay scripts remain
unchanged. v12 is a new corpus ID and directory, as required by the existing
immutable release policy. Historical v11 replay requires its original matching
source release; its pins must not be rewritten to describe the current source.

## Preserved definitions

- All 600 v11 case objects, including inputs, expected outcomes, labels, IDs,
  graders and source references, are inherited byte-identically in canonical
  JSON. Only each suite's top-level corpus ID changes.
- The compact v12 generator verifies the original release receipt and suite
  hashes, copies the frozen case objects and never recomputes expected values.
- The original authorship record is retained as inherited authorship; it does
  not claim that the cases were newly authored in this revision.
- The six 100-case suites still contribute zero points. The separate 28-case
  deep evaluation retains its original 100-point maximum.

## Updated publication metadata

v12 binds the current dependency lock and 115 evaluator-source files, including
the new configurable legal-contact module. Its manifest, provenance, integrity
record and release receipt describe the new corpus ID
`bora-judge-coverage-2026-09-23-v12`. The application registry and npm evaluation
commands now select that version. Old stored sessions are not relabeled or
migrated by this change.

## Actual local verification

The release receipt was written by `generate-judge-coverage-corpus-v12.mjs
--seal` only after its validator and offline replay both succeeded. Subsequent
`--require-sealed` validation and replay also succeeded:

- 600 unique definitions; 600 passed, 0 failed, 0 errors; all suite gates pass.
- Repeated replay is byte-identical; observed fetch, time and randomness calls
  are zero within the existing declared instrumentation boundary.
- Canonical 28 + 600 replay passes: deep score 100/100, coverage 600/600.
- All 11 `tests/judge-evaluation.test.mjs` tests pass.

The inherited definition hash is
`b55787f2a5463c6a304ea6b03286be2b6b40d929a7cab3c221e1889ebb371d84`;
the replay result hash remains identical to v11:
`5f16ac42e4ddfaaab0902cfc0b228201f4cda4332cc3e2c839a245b713b0f819`.

These are deterministic implementation-regression results, not an official
competition score, an independent expert review or a production-live-data test.
