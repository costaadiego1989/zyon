-- Switch knowledge_chunks.embedding_vec to 384 dims (local all-MiniLM-L6-v2).
-- Safe drop+recreate: embeddings are regenerable from source content and the
-- repo falls back to base64 TEXT cosine when the pgvector column is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE knowledge_chunks DROP COLUMN IF EXISTS embedding_vec;
    ALTER TABLE knowledge_chunks ADD COLUMN embedding_vec vector(384);
    CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_vec_idx
      ON knowledge_chunks USING hnsw (embedding_vec vector_cosine_ops) WITH (m = 16, ef_construction = 64);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available or index build skipped; base64 fallback in use';
END $$;
