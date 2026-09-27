# OAuth login-start protection

Consented login starts share a database-backed limit across Google, Kakao and
Naver: 120 requests per minute globally, and 12 per client. A single conditional
SQLite/D1 update checks and increments both counters atomically across workers.
These limits allow ordinary retries while bounding new OAuth transaction growth.
The global limit remains effective even if client headers are changed or forged.

Only a valid, current-consent POST with a configured provider and valid callback
origin reaches the limiter. Navigational GETs and rejected inputs create no
transaction and consume no login-start quota. A blocked start returns a no-store
429 and `Retry-After`; a database/limiter failure returns a no-store 503 and
`Retry-After: 60`. Neither response replaces the OAuth state cookie or deletes
an existing transaction, session, or user's data.

The client discriminator uses a canonical, single `CF-Connecting-IP` value.
`X-Forwarded-For` is ignored; missing or malformed values share an unknown bucket.
Cloudflare ingress must remain the only public path to the origin, but the
client header is **not** trusted for authentication. It only refines the global
limit. A shared NAT may hit the client threshold, and a deliberate global flood
can temporarily delay legitimate starts; edge-level abuse controls remain useful.

The new `oauth_start_rate_limits` table has one fixed row and at most 120 HMAC
client keys in that row. A random persisted HMAC key prevents plain IP hashing;
no plaintext IP, user identifier, or request body is recorded. An expired window
is replaced in place on the next accepted request, discarding old counters.
The last window may remain on disk until the next request. Database permissions
and backups must protect this table like other private runtime data.

The additive `0027_oauth_start_rate_limit.sql` schema is also initialized
idempotently at runtime. Previous releases ignore the extra table, so rollback
does not require restoring an older database or discarding new user writes.
