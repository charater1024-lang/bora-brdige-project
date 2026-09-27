# Authentication and query-index coverage v17

This source revision inherits the 600 frozen v16 case objects, IDs, inputs,
expected results, graders and source references. It does not recompute expected
results. The sealed v16 predecessor receipt is pinned to SHA-256
`9926168a75b04a8747b53101f7adaed7c44e23ccb8402c6c5f4eb2ca62f4d889`.
Existing v1-v16 artifacts and evaluator scripts remain unchanged.

The current source/dependency bundle also covers the additional query-index
migration, OAuth callback recovery, bounded provider/client response handling,
account request ownership and their regression tests. The six suite gates and
zero contribution to the existing 28-case deep score remain unchanged.

The generator refuses to overwrite a sealed release. `--seal` runs the real
validator and deterministic replay before creating a receipt. Until that
receipt exists, a draft is not a passing sealed evaluation. Existing v11-v16
saved results retain their original identities and are read-only history.

The inherited 600 cases do not themselves exercise every new regression test,
measure end-to-end page latency, or prove real OAuth, live upstream APIs, model
quality, 24-hour load completion or multi-week stability. Those checks require
separate evidence. A successful index EXPLAIN/SQL benchmark is not a website
speed benchmark. Neither evaluation results nor candidate source imply a
production deployment has occurred.
