-- Incremental refresh of the shared public-only search projection.
-- Apply after 0023 through the transactional migration runner. No user tables
-- are read or changed. Keep row IDs and FTS tokens for unchanged document text;
-- retain metadata updates and remove records only when absent from live chunks.
DROP TRIGGER IF EXISTS public_rag_chunk_insert;
DROP TRIGGER IF EXISTS public_rag_chunk_update;
DROP TRIGGER IF EXISTS public_rag_chunk_delete;
DROP TRIGGER IF EXISTS public_rag_document_update;
DROP VIEW IF EXISTS public_rag_catalog_projection;

CREATE VIEW public_rag_catalog_projection AS
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
    'applicationStartsAt', json_extract(i.value, '$.applicationStartsAt'),
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

-- Public doc-to-chunk membership is rebuildable and contains no user data.
-- The secondary key bounds duplicate lookup even during full reorder/removal.
CREATE TABLE IF NOT EXISTS public_rag_chunk_members (
  source_id TEXT NOT NULL,
  category TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  doc_id TEXT NOT NULL,
  PRIMARY KEY(source_id, category, chunk_index, doc_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS public_rag_chunk_members_doc_idx
  ON public_rag_chunk_members(source_id, category, doc_id, chunk_index);
-- Rebuild only this small derived membership map, never the FTS index.
DELETE FROM public_rag_chunk_members;
INSERT INTO public_rag_chunk_members(source_id, category, chunk_index, doc_id)
SELECT source_id, category, chunk_index, doc_id FROM public_rag_catalog_projection WHERE 1
ON CONFLICT(source_id, category, chunk_index, doc_id) DO NOTHING;

CREATE TRIGGER public_rag_document_update AFTER UPDATE ON public_rag_documents
WHEN old.row_id IS NOT new.row_id OR old.title IS NOT new.title
  OR old.body IS NOT new.body OR old.tags IS NOT new.tags
BEGIN
  INSERT INTO public_rag_fts(public_rag_fts, rowid, title, body, tags)
    VALUES ('delete', old.row_id, old.title, old.body, old.tags);
  INSERT INTO public_rag_fts(rowid, title, body, tags)
    VALUES (new.row_id, new.title, new.body, new.tags);
END;

-- SQLite/workerd's normal recursive_triggers=OFF also uses this AFTER INSERT
-- path for INSERT OR REPLACE. With recursive_triggers=ON, SQLite additionally
-- fires DELETE before replacement; correctness is preserved but that operation
-- can require delete/reinsert work. Plain UPSERT avoids that SQLite behavior.
CREATE TRIGGER public_rag_chunk_insert AFTER INSERT ON public_data_catalog_chunks BEGIN
  -- Diff this chunk's membership; unchanged IDs cause no membership writes.
  DELETE FROM public_rag_chunk_members
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_catalog_projection WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index);
  INSERT INTO public_rag_chunk_members(source_id, category, chunk_index, doc_id)
  SELECT source_id, category, chunk_index, doc_id FROM public_rag_catalog_projection
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND 1
  ON CONFLICT(source_id, category, chunk_index, doc_id) DO NOTHING;
  INSERT INTO public_rag_documents
    (source_id, category, chunk_index, doc_id, title, body, tags, payload,
     published_at, verified_at, expires_at, indexed_at)
  SELECT source_id, category, chunk_index, doc_id, title, body, tags, payload,
    published_at, verified_at, expires_at, indexed_at
  FROM public_rag_catalog_projection WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index
  ON CONFLICT(source_id, category, doc_id) DO UPDATE SET
    chunk_index=excluded.chunk_index, title=excluded.title, body=excluded.body, tags=excluded.tags, payload=excluded.payload, published_at=excluded.published_at, verified_at=excluded.verified_at, expires_at=excluded.expires_at, indexed_at=excluded.indexed_at
  WHERE public_rag_documents.chunk_index IS NOT excluded.chunk_index
    OR public_rag_documents.title IS NOT excluded.title
    OR public_rag_documents.body IS NOT excluded.body
    OR public_rag_documents.tags IS NOT excluded.tags
    OR public_rag_documents.payload IS NOT excluded.payload
    OR public_rag_documents.published_at IS NOT excluded.published_at
    OR public_rag_documents.verified_at IS NOT excluded.verified_at
    OR public_rag_documents.expires_at IS NOT excluded.expires_at
    OR public_rag_documents.indexed_at IS NOT excluded.indexed_at;
  -- Membership checks use a B-tree, not a scan of every source JSON chunk.
  -- Rehome JSON parsing is restricted to indexed copies of this exact doc ID.
  UPDATE public_rag_documents SET
    (chunk_index, title, body, tags, payload, published_at, verified_at, expires_at, indexed_at) = (
      SELECT p.chunk_index, p.title, p.body, p.tags, p.payload, p.published_at, p.verified_at, p.expires_at, p.indexed_at
      FROM public_rag_catalog_projection p
      WHERE p.source_id = public_rag_documents.source_id
        AND p.category = public_rag_documents.category
        AND p.chunk_index IN (SELECT m.chunk_index FROM public_rag_chunk_members m
          WHERE m.source_id = public_rag_documents.source_id
            AND m.category = public_rag_documents.category
            AND m.doc_id = public_rag_documents.doc_id)
        AND p.doc_id = public_rag_documents.doc_id
      ORDER BY p.indexed_at DESC, p.chunk_index DESC LIMIT 1
    )
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index)
    AND EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
  DELETE FROM public_rag_documents
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index)
    AND NOT EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
END;

CREATE TRIGGER public_rag_chunk_update AFTER UPDATE ON public_data_catalog_chunks BEGIN
  -- Diff this chunk's membership; unchanged IDs cause no membership writes.
  DELETE FROM public_rag_chunk_members
  WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_catalog_projection WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index);
  INSERT INTO public_rag_chunk_members(source_id, category, chunk_index, doc_id)
  SELECT source_id, category, chunk_index, doc_id FROM public_rag_catalog_projection
  WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index AND 1
  ON CONFLICT(source_id, category, chunk_index, doc_id) DO NOTHING;
  -- Diff this chunk's membership; unchanged IDs cause no membership writes.
  DELETE FROM public_rag_chunk_members
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND (old.source_id IS NOT new.source_id OR old.category IS NOT new.category OR old.chunk_index IS NOT new.chunk_index)
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_catalog_projection WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index);
  INSERT INTO public_rag_chunk_members(source_id, category, chunk_index, doc_id)
  SELECT source_id, category, chunk_index, doc_id FROM public_rag_catalog_projection
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND (old.source_id IS NOT new.source_id OR old.category IS NOT new.category OR old.chunk_index IS NOT new.chunk_index)
  ON CONFLICT(source_id, category, chunk_index, doc_id) DO NOTHING;
  INSERT INTO public_rag_documents
    (source_id, category, chunk_index, doc_id, title, body, tags, payload,
     published_at, verified_at, expires_at, indexed_at)
  SELECT source_id, category, chunk_index, doc_id, title, body, tags, payload,
    published_at, verified_at, expires_at, indexed_at
  FROM public_rag_catalog_projection WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index
  ON CONFLICT(source_id, category, doc_id) DO UPDATE SET
    chunk_index=excluded.chunk_index, title=excluded.title, body=excluded.body, tags=excluded.tags, payload=excluded.payload, published_at=excluded.published_at, verified_at=excluded.verified_at, expires_at=excluded.expires_at, indexed_at=excluded.indexed_at
  WHERE public_rag_documents.chunk_index IS NOT excluded.chunk_index
    OR public_rag_documents.title IS NOT excluded.title
    OR public_rag_documents.body IS NOT excluded.body
    OR public_rag_documents.tags IS NOT excluded.tags
    OR public_rag_documents.payload IS NOT excluded.payload
    OR public_rag_documents.published_at IS NOT excluded.published_at
    OR public_rag_documents.verified_at IS NOT excluded.verified_at
    OR public_rag_documents.expires_at IS NOT excluded.expires_at
    OR public_rag_documents.indexed_at IS NOT excluded.indexed_at;
  -- Membership checks use a B-tree, not a scan of every source JSON chunk.
  -- Rehome JSON parsing is restricted to indexed copies of this exact doc ID.
  UPDATE public_rag_documents SET
    (chunk_index, title, body, tags, payload, published_at, verified_at, expires_at, indexed_at) = (
      SELECT p.chunk_index, p.title, p.body, p.tags, p.payload, p.published_at, p.verified_at, p.expires_at, p.indexed_at
      FROM public_rag_catalog_projection p
      WHERE p.source_id = public_rag_documents.source_id
        AND p.category = public_rag_documents.category
        AND p.chunk_index IN (SELECT m.chunk_index FROM public_rag_chunk_members m
          WHERE m.source_id = public_rag_documents.source_id
            AND m.category = public_rag_documents.category
            AND m.doc_id = public_rag_documents.doc_id)
        AND p.doc_id = public_rag_documents.doc_id
      ORDER BY p.indexed_at DESC, p.chunk_index DESC LIMIT 1
    )
  WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index)
    AND EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
  DELETE FROM public_rag_documents
  WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index)
    AND NOT EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
  -- Membership checks use a B-tree, not a scan of every source JSON chunk.
  -- Rehome JSON parsing is restricted to indexed copies of this exact doc ID.
  UPDATE public_rag_documents SET
    (chunk_index, title, body, tags, payload, published_at, verified_at, expires_at, indexed_at) = (
      SELECT p.chunk_index, p.title, p.body, p.tags, p.payload, p.published_at, p.verified_at, p.expires_at, p.indexed_at
      FROM public_rag_catalog_projection p
      WHERE p.source_id = public_rag_documents.source_id
        AND p.category = public_rag_documents.category
        AND p.chunk_index IN (SELECT m.chunk_index FROM public_rag_chunk_members m
          WHERE m.source_id = public_rag_documents.source_id
            AND m.category = public_rag_documents.category
            AND m.doc_id = public_rag_documents.doc_id)
        AND p.doc_id = public_rag_documents.doc_id
      ORDER BY p.indexed_at DESC, p.chunk_index DESC LIMIT 1
    )
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND (old.source_id IS NOT new.source_id OR old.category IS NOT new.category OR old.chunk_index IS NOT new.chunk_index)
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index)
    AND EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
  DELETE FROM public_rag_documents
  WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index AND (old.source_id IS NOT new.source_id OR old.category IS NOT new.category OR old.chunk_index IS NOT new.chunk_index)
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = new.source_id AND category = new.category AND chunk_index = new.chunk_index)
    AND NOT EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
END;

CREATE TRIGGER public_rag_chunk_delete AFTER DELETE ON public_data_catalog_chunks BEGIN
  DELETE FROM public_rag_chunk_members WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index;
  -- Membership checks use a B-tree, not a scan of every source JSON chunk.
  -- Rehome JSON parsing is restricted to indexed copies of this exact doc ID.
  UPDATE public_rag_documents SET
    (chunk_index, title, body, tags, payload, published_at, verified_at, expires_at, indexed_at) = (
      SELECT p.chunk_index, p.title, p.body, p.tags, p.payload, p.published_at, p.verified_at, p.expires_at, p.indexed_at
      FROM public_rag_catalog_projection p
      WHERE p.source_id = public_rag_documents.source_id
        AND p.category = public_rag_documents.category
        AND p.chunk_index IN (SELECT m.chunk_index FROM public_rag_chunk_members m
          WHERE m.source_id = public_rag_documents.source_id
            AND m.category = public_rag_documents.category
            AND m.doc_id = public_rag_documents.doc_id)
        AND p.doc_id = public_rag_documents.doc_id
      ORDER BY p.indexed_at DESC, p.chunk_index DESC LIMIT 1
    )
  WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index)
    AND EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
  DELETE FROM public_rag_documents
  WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index AND 1
    AND doc_id NOT IN (SELECT doc_id FROM public_rag_chunk_members WHERE source_id = old.source_id AND category = old.category AND chunk_index = old.chunk_index)
    AND NOT EXISTS (SELECT 1 FROM public_rag_chunk_members m
      WHERE m.source_id = public_rag_documents.source_id
        AND m.category = public_rag_documents.category
        AND m.doc_id = public_rag_documents.doc_id);
END;

-- Refresh the allow-listed projection once (including applicationStartsAt).
-- Existing IDs remain stable; the new text-change guard avoids FTS work for
-- metadata-only differences. Newer duplicate copies win deterministically.
  INSERT INTO public_rag_documents
    (source_id, category, chunk_index, doc_id, title, body, tags, payload,
     published_at, verified_at, expires_at, indexed_at)
  SELECT source_id, category, chunk_index, doc_id, title, body, tags, payload,
    published_at, verified_at, expires_at, indexed_at
  FROM public_rag_catalog_projection WHERE 1
  ORDER BY indexed_at ASC, chunk_index ASC
  ON CONFLICT(source_id, category, doc_id) DO UPDATE SET
    chunk_index=excluded.chunk_index, title=excluded.title, body=excluded.body, tags=excluded.tags, payload=excluded.payload, published_at=excluded.published_at, verified_at=excluded.verified_at, expires_at=excluded.expires_at, indexed_at=excluded.indexed_at
  WHERE public_rag_documents.chunk_index IS NOT excluded.chunk_index
    OR public_rag_documents.title IS NOT excluded.title
    OR public_rag_documents.body IS NOT excluded.body
    OR public_rag_documents.tags IS NOT excluded.tags
    OR public_rag_documents.payload IS NOT excluded.payload
    OR public_rag_documents.published_at IS NOT excluded.published_at
    OR public_rag_documents.verified_at IS NOT excluded.verified_at
    OR public_rag_documents.expires_at IS NOT excluded.expires_at
    OR public_rag_documents.indexed_at IS NOT excluded.indexed_at;
