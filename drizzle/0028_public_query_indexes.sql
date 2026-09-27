-- Additive query-plan indexes only. No table/row/trigger changes or backfill.
-- Complete both sides of the OAuth cleanup OR without changing retention.
CREATE INDEX IF NOT EXISTS oauth_transactions_consumed_at_idx
  ON oauth_transactions (consumed_at) WHERE consumed_at IS NOT NULL;

-- Category reads order by chunk first, then source. Keep the existing
-- category/source index because aggregate/source lookups still use it.
CREATE INDEX IF NOT EXISTS public_data_catalog_chunks_page_order_idx
  ON public_data_catalog_chunks (category, chunk_index, source_id);
