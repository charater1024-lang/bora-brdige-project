UPDATE service_api_settings
SET enabled = 0,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE key_name = 'WORK24_API_KEY';

UPDATE public_api_source_state
SET next_due_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 21600000,
    backoff_until = 0,
    consecutive_failures = 0,
    last_error = 'disabled_by_operator',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE source_id = 'work24'
  AND reserved_calls = 0;

SELECT key_name, enabled
FROM service_api_settings
WHERE key_name = 'WORK24_API_KEY';

SELECT source_id, reserved_calls, consecutive_failures, last_error
FROM public_api_source_state
WHERE source_id = 'work24';
