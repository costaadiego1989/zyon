-- knowledge-base tables (RAG support)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kc_merchant_source ON knowledge_chunks(merchant_id, source_type);

-- pgvector column (production) — add if extension available
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available, using base64 fallback';
END $$;

-- HNSW index for fast cosine similarity (only if pgvector column exists)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_kc_embedding_vec ON knowledge_chunks
    USING hnsw (embedding_vec vector_cosine_ops) WITH (m = 16, ef_construction = 64);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'skipping HNSW index — embedding_vec column may not exist';
END $$;

-- merchant policies table
CREATE TABLE IF NOT EXISTS merchant_policies (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE,
  returns TEXT,
  shipping TEXT,
  warranty TEXT,
  payment TEXT,
  general TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
