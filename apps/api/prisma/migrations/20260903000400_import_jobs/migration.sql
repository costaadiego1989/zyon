-- Async product-import jobs (ai-spreadsheet-import feature). Tracks a Growth+
-- merchant's spreadsheet upload as it is parsed, LLM-column-mapped, normalized
-- and bulk-created. Idempotent: safe for environments provisioned via `prisma db push`.

CREATE TABLE IF NOT EXISTS "import_jobs" (
    "id"             TEXT NOT NULL,
    "merchant_id"    TEXT NOT NULL,
    "kind"           TEXT NOT NULL DEFAULT 'product_spreadsheet',
    "status"         TEXT NOT NULL DEFAULT 'queued',
    "file_name"      TEXT NOT NULL,
    "total_rows"     INTEGER NOT NULL DEFAULT 0,
    "success_rows"   INTEGER NOT NULL DEFAULT 0,
    "failed_rows"    INTEGER NOT NULL DEFAULT 0,
    "column_mapping" JSONB NOT NULL DEFAULT '{}',
    "errors"         JSONB NOT NULL DEFAULT '[]',
    "file_ref"       TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at"    TIMESTAMP(3),
    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "import_jobs_merchant_id_status_created_at_idx"
  ON "import_jobs"("merchant_id", "status", "created_at");
