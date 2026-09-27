-- A shared, rebuildable search projection of the existing public catalogue.
-- No user data, credentials, generated answers or extra upstream calls.
CREATE TABLE IF NOT EXISTS public_rag_documents (
  row_id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  category TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  payload TEXT NOT NULL,
  published_at TEXT,
  verified_at TEXT,
  expires_at TEXT,
  indexed_at INTEGER NOT NULL,
  UNIQUE (source_id, category, doc_id)
);
CREATE INDEX IF NOT EXISTS public_rag_documents_chunk_idx
  ON public_rag_documents (source_id, category, chunk_index);
CREATE INDEX IF NOT EXISTS public_rag_documents_category_idx
  ON public_rag_documents (category, expires_at);
CREATE VIRTUAL TABLE IF NOT EXISTS public_rag_fts USING fts5(
  title, body, tags, content='public_rag_documents', content_rowid='row_id',
  tokenize='unicode61 remove_diacritics 2', prefix='2 3 4'
);
CREATE TRIGGER IF NOT EXISTS public_rag_document_insert AFTER INSERT ON public_rag_documents BEGIN
  INSERT INTO public_rag_fts(rowid, title, body, tags)
    VALUES (new.row_id, new.title, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS public_rag_document_delete AFTER DELETE ON public_rag_documents BEGIN
  INSERT INTO public_rag_fts(public_rag_fts, rowid, title, body, tags)
    VALUES ('delete', old.row_id, old.title, old.body, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS public_rag_document_update AFTER UPDATE ON public_rag_documents BEGIN
  INSERT INTO public_rag_fts(public_rag_fts, rowid, title, body, tags)
    VALUES ('delete', old.row_id, old.title, old.body, old.tags);
  INSERT INTO public_rag_fts(rowid, title, body, tags)
    VALUES (new.row_id, new.title, new.body, new.tags);
END;

-- The projection intentionally excludes commercial geometry and takes only
-- public, allow-listed item fields. Each provider chunk contains <=100 items.
CREATE VIEW IF NOT EXISTS public_rag_catalog_projection AS
SELECT c.source_id, c.category, c.chunk_index,
  json_extract(i.value, '$.id') AS doc_id,
  substr(json_extract(i.value, '$.title'), 1, 400) AS title,
  substr(coalesce(json_extract(i.value, '$.summary'), ''), 1, 6000)
    || char(10) || substr(coalesce(json_extract(i.value, '$.financialProduct'), ''), 1, 8000)
    || char(10) || coalesce(json_extract(i.value, '$.employmentStatistic'), '')
    || char(10) || coalesce(json_extract(i.value, '$.youthPolicyEligibility'), '') AS body,
  coalesce(json_extract(i.value, '$.tags'), '[]') AS tags,
  json_object(
    'id', json_extract(i.value, '$.id'),
    'category', c.category,
    'title', substr(json_extract(i.value, '$.title'), 1, 400),
    'summary', substr(coalesce(json_extract(i.value, '$.summary'), ''), 1, 6000),
    'source', json_extract(i.value, '$.source'),
    'sourceUrl', json_extract(i.value, '$.sourceUrl'),
    'sourceLinkKind', json_extract(i.value, '$.sourceLinkKind'),
    'publishedAt', json_extract(i.value, '$.publishedAt'),
    'discoveredAt', json_extract(i.value, '$.discoveredAt'),
    'expiresAt', json_extract(i.value, '$.expiresAt'),
    'lastVerifiedAt', json_extract(i.value, '$.lastVerifiedAt'),
    'tags', json(json_extract(i.value, '$.tags')),
    'location', json_object('province', json_extract(i.value, '$.location.province'),
      'city', json_extract(i.value, '$.location.city'), 'label', json_extract(i.value, '$.location.label')),
    'financialProduct', json(json_extract(i.value, '$.financialProduct')),
    'employmentStatistic', json(json_extract(i.value, '$.employmentStatistic')),
    'youthPolicyEligibility', json(json_extract(i.value, '$.youthPolicyEligibility'))
  ) AS payload,
  json_extract(i.value, '$.publishedAt') AS published_at,
  coalesce(json_extract(i.value, '$.lastVerifiedAt'), json_extract(i.value, '$.discoveredAt')) AS verified_at,
  json_extract(i.value, '$.expiresAt') AS expires_at,
  c.updated_at AS indexed_at
FROM public_data_catalog_chunks c,
  json_each(c.payload, '$.categories') g,
  json_each(g.value, '$.items') i
WHERE json_valid(c.payload)
  AND json_extract(g.value, '$.id') = c.category
  AND json_type(i.value, '$.commercialArea') IS NULL
  AND json_type(i.value, '$.id') = 'text'
  AND json_type(i.value, '$.title') = 'text';

-- AFTER INSERT also covers INSERT OR REPLACE when recursive_triggers is off:
-- explicitly remove the old chunk's projection before adding its replacement.
CREATE TRIGGER IF NOT EXISTS public_rag_chunk_insert AFTER INSERT ON public_data_catalog_chunks BEGIN
  DELETE FROM public_rag_documents
    WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index;
  INSERT INTO public_rag_documents
    (source_id, category, chunk_index, doc_id, title, body, tags, payload,
     published_at, verified_at, expires_at, indexed_at)
  SELECT source_id, category, chunk_index, doc_id, title, body, tags, payload,
    published_at, verified_at, expires_at, indexed_at
  FROM public_rag_catalog_projection
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index
  ON CONFLICT(source_id, category, doc_id) DO UPDATE SET
    chunk_index=excluded.chunk_index, title=excluded.title, body=excluded.body,
    tags=excluded.tags, payload=excluded.payload, published_at=excluded.published_at,
    verified_at=excluded.verified_at, expires_at=excluded.expires_at, indexed_at=excluded.indexed_at;
END;
CREATE TRIGGER IF NOT EXISTS public_rag_chunk_update AFTER UPDATE ON public_data_catalog_chunks BEGIN
  DELETE FROM public_rag_documents
    WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index;
  INSERT INTO public_rag_documents
    (source_id, category, chunk_index, doc_id, title, body, tags, payload,
     published_at, verified_at, expires_at, indexed_at)
  SELECT source_id, category, chunk_index, doc_id, title, body, tags, payload,
    published_at, verified_at, expires_at, indexed_at
  FROM public_rag_catalog_projection
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index
  ON CONFLICT(source_id, category, doc_id) DO UPDATE SET
    chunk_index=excluded.chunk_index, title=excluded.title, body=excluded.body,
    tags=excluded.tags, payload=excluded.payload, published_at=excluded.published_at,
    verified_at=excluded.verified_at, expires_at=excluded.expires_at, indexed_at=excluded.indexed_at;
END;
CREATE TRIGGER IF NOT EXISTS public_rag_chunk_delete AFTER DELETE ON public_data_catalog_chunks BEGIN
  DELETE FROM public_rag_documents
    WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index;
END;

-- Initial full backfill runs once, transactionally, in the migration runner.
-- Later provider refreshes keep it current via bounded per-chunk triggers.
INSERT INTO public_rag_documents
  (source_id, category, chunk_index, doc_id, title, body, tags, payload,
   published_at, verified_at, expires_at, indexed_at)
SELECT source_id, category, chunk_index, doc_id, title, body, tags, payload,
  published_at, verified_at, expires_at, indexed_at
FROM public_rag_catalog_projection WHERE 1
ON CONFLICT(source_id, category, doc_id) DO UPDATE SET
  chunk_index=excluded.chunk_index, title=excluded.title, body=excluded.body,
  tags=excluded.tags, payload=excluded.payload, published_at=excluded.published_at,
  verified_at=excluded.verified_at, expires_at=excluded.expires_at, indexed_at=excluded.indexed_at;
