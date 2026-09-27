-- Financial-company rows are point-in-time verification data. Historical
-- provider pages must not become a current catalogue merely because the
-- upstream API accepted broad paging. Keep only a bounded Seoul-date snapshot
-- in the rebuildable public RAG projection; source chunks remain untouched.
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
  AND json_type(i.value, '$.title') = 'text'
  AND (c.source_id <> 'financial-company' OR (
    length(json_extract(i.value, '$.publishedAt')) = 10
    AND json_extract(i.value, '$.publishedAt')
      GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
    AND date(json_extract(i.value, '$.publishedAt'), '+0 days')
      = json_extract(i.value, '$.publishedAt')
    AND date(json_extract(i.value, '$.publishedAt')) BETWEEN
      date('now', '+9 hours', '-30 days') AND date('now', '+9 hours', '+1 day')
  ));

-- Rebuild only this provider's derived membership. A recent valid generation
-- remains indexed even if a later provider probe fails; stale rows never do.
DELETE FROM public_rag_chunk_members WHERE source_id = 'financial-company';
INSERT INTO public_rag_chunk_members(source_id, category, chunk_index, doc_id)
SELECT source_id, category, chunk_index, doc_id
FROM public_rag_catalog_projection WHERE source_id = 'financial-company'
ON CONFLICT(source_id, category, chunk_index, doc_id) DO NOTHING;

DELETE FROM public_rag_documents
WHERE source_id = 'financial-company'
  AND NOT EXISTS (
    SELECT 1 FROM public_rag_catalog_projection p
    WHERE p.source_id = public_rag_documents.source_id
      AND p.category = public_rag_documents.category
      AND p.doc_id = public_rag_documents.doc_id
  );

INSERT INTO public_rag_documents
  (source_id, category, chunk_index, doc_id, title, body, tags, payload,
   published_at, verified_at, expires_at, indexed_at)
SELECT source_id, category, chunk_index, doc_id, title, body, tags, payload,
  published_at, verified_at, expires_at, indexed_at
FROM public_rag_catalog_projection WHERE source_id = 'financial-company'
ORDER BY indexed_at ASC, chunk_index ASC
ON CONFLICT(source_id, category, doc_id) DO UPDATE SET
  chunk_index=excluded.chunk_index, title=excluded.title, body=excluded.body,
  tags=excluded.tags, payload=excluded.payload,
  published_at=excluded.published_at, verified_at=excluded.verified_at,
  expires_at=excluded.expires_at, indexed_at=excluded.indexed_at
WHERE public_rag_documents.chunk_index IS NOT excluded.chunk_index
  OR public_rag_documents.title IS NOT excluded.title
  OR public_rag_documents.body IS NOT excluded.body
  OR public_rag_documents.tags IS NOT excluded.tags
  OR public_rag_documents.payload IS NOT excluded.payload
  OR public_rag_documents.published_at IS NOT excluded.published_at
  OR public_rag_documents.verified_at IS NOT excluded.verified_at
  OR public_rag_documents.expires_at IS NOT excluded.expires_at
  OR public_rag_documents.indexed_at IS NOT excluded.indexed_at;
