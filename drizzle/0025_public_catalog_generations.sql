-- Additive staging/publish metadata for atomic public catalogue replacement.
-- Existing live rows remain authoritative until a complete generation is
-- published into public_data_catalog_chunks in one transaction.
CREATE TABLE IF NOT EXISTS public_data_catalog_generations (
  source_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  category TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND 100),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(source_id, generation_id, category, chunk_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS public_data_catalog_generations_created_idx
  ON public_data_catalog_generations(source_id, created_at, generation_id);
CREATE TABLE IF NOT EXISTS public_data_catalog_generation_pointers (
  source_id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK(item_count >= 0),
  published_at INTEGER NOT NULL
) WITHOUT ROWID;
