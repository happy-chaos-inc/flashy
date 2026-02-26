-- RAG document chunks table with hybrid search (dense + sparse + RRF)
-- Requires pgvector extension for embedding storage and similarity search

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Document chunks table for RAG pipeline
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text_content TEXT NOT NULL,
  embedding extensions.vector(1536),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', text_content)) STORED,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, file_name, chunk_index)
);

-- HNSW index for fast approximate nearest neighbor search on embeddings
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_document_chunks_search_vector
  ON document_chunks
  USING gin (search_vector);

-- B-tree index for room_id lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_room_id
  ON document_chunks (room_id);

-- Composite index for file cleanup operations
CREATE INDEX IF NOT EXISTS idx_document_chunks_room_file
  ON document_chunks (room_id, file_name);

-- Hybrid search function: combines dense (vector) and sparse (full-text) results via RRF
CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding extensions.vector(1536),
  query_text TEXT,
  p_room_id TEXT,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  room_id TEXT,
  file_name TEXT,
  chunk_index INTEGER,
  text_content TEXT,
  metadata JSONB,
  rrf_score DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      dc.id,
      dc.room_id,
      dc.file_name,
      dc.chunk_index,
      dc.text_content,
      dc.metadata,
      ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS rank
    FROM document_chunks dc
    WHERE dc.room_id = p_room_id
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  fts_results AS (
    SELECT
      dc.id,
      dc.room_id,
      dc.file_name,
      dc.chunk_index,
      dc.text_content,
      dc.metadata,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(dc.search_vector, plainto_tsquery('english', query_text)) DESC) AS rank
    FROM document_chunks dc
    WHERE dc.room_id = p_room_id
      AND dc.search_vector @@ plainto_tsquery('english', query_text)
    ORDER BY ts_rank_cd(dc.search_vector, plainto_tsquery('english', query_text)) DESC
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, f.id) AS id,
      COALESCE(v.room_id, f.room_id) AS room_id,
      COALESCE(v.file_name, f.file_name) AS file_name,
      COALESCE(v.chunk_index, f.chunk_index) AS chunk_index,
      COALESCE(v.text_content, f.text_content) AS text_content,
      COALESCE(v.metadata, f.metadata) AS metadata,
      -- RRF score: 1/(k + rank) for each result set, summed
      COALESCE(1.0 / (60 + v.rank), 0.0) + COALESCE(1.0 / (60 + f.rank), 0.0) AS rrf_score
    FROM vector_results v
    FULL OUTER JOIN fts_results f ON v.id = f.id
  )
  SELECT
    combined.id,
    combined.room_id,
    combined.file_name,
    combined.chunk_index,
    combined.text_content,
    combined.metadata,
    combined.rrf_score
  FROM combined
  ORDER BY combined.rrf_score DESC
  LIMIT match_count;
END;
$$;

-- Batch upsert chunks (idempotent — re-uploading replaces existing chunks)
CREATE OR REPLACE FUNCTION upsert_chunks(
  p_chunks JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
  v_chunk JSONB;
BEGIN
  FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks)
  LOOP
    INSERT INTO document_chunks (room_id, file_name, chunk_index, text_content, embedding, metadata)
    VALUES (
      v_chunk->>'room_id',
      v_chunk->>'file_name',
      (v_chunk->>'chunk_index')::INTEGER,
      v_chunk->>'text_content',
      (v_chunk->>'embedding')::extensions.vector,
      COALESCE(v_chunk->'metadata', '{}'::JSONB)
    )
    ON CONFLICT (room_id, file_name, chunk_index)
    DO UPDATE SET
      text_content = EXCLUDED.text_content,
      embedding = EXCLUDED.embedding,
      metadata = EXCLUDED.metadata,
      created_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Delete all chunks for a specific file in a room
CREATE OR REPLACE FUNCTION delete_file_chunks(
  p_room_id TEXT,
  p_file_name TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM document_chunks
  WHERE room_id = p_room_id AND file_name = p_file_name;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Enable RLS
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- Service role has full access (edge functions use service role)
CREATE POLICY "Service role can manage document_chunks" ON document_chunks
  FOR ALL
  USING (true)
  WITH CHECK (true);
