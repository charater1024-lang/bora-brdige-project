-- Additive and independent of login transactions, accounts and AI quotas.
-- Runtime initialization supplies a random HMAC salt to the singleton row.
CREATE TABLE IF NOT EXISTS oauth_start_rate_limits (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  client_counts_json TEXT NOT NULL,
  client_salt TEXT NOT NULL
);
