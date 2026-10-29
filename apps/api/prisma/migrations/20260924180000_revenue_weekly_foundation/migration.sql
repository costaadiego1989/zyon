-- Reuse compatible shared AI telemetry without dropping or rewriting data.
-- Atomic guards also allow safe replay after an interrupted deployment.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('revenue-weekly-foundation'), 0);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_usage_events" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_event_id" TEXT,
    "merchant_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "execution_status" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "cost_micros" BIGINT,
    "currency" TEXT,
    "pricing_version" TEXT,
    "cost_status" TEXT NOT NULL DEFAULT 'unpriced',
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "conversation_id" TEXT,
    "voice_session_id" TEXT,
    "correlation_id" TEXT,
    "parent_usage_event_id" TEXT,
    "metadata" JSONB,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_price_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "input_micros_per_million" BIGINT,
    "output_micros_per_million" BIGINT,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_price_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "revenue_analysis_schedules" (
    "merchant_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "group" INTEGER NOT NULL,
    "next_due_at" TIMESTAMP(3) NOT NULL,
    "last_successful_at" TIMESTAMP(3),
    "current_run_id" TEXT,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "migrated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_analysis_schedules_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "revenue_analysis_runs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "result" TEXT,
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMP(3),
    "retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "as_of" TIMESTAMP(3),
    "observation_id" TEXT,
    "hypothesis_id" TEXT,
    "generated_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "revenue_analysis_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "revenue_ai_reservations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "work_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price_version" TEXT NOT NULL,
    "input_rate" BIGINT NOT NULL,
    "output_rate" BIGINT NOT NULL,
    "max_input_tokens" INTEGER NOT NULL,
    "max_output_tokens" INTEGER NOT NULL,
    "amount_micros" BIGINT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'dispatched',
    "usage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "revenue_ai_reservations_pkey" PRIMARY KEY ("id")
);


-- Shared cost telemetry may predate the Revenue migration history. Accept it
-- only when every required column has the exact compatible type/nullability.
-- No existing rows, defaults, columns, constraints or ownership are rewritten.
DO $foundation_columns$
DECLARE problem text;
BEGIN
  WITH required(table_name, column_name, type_name, not_null) AS (VALUES
    ('ai_usage_events', 'id', 'text', true),
    ('ai_usage_events', 'idempotency_key', 'text', true),
    ('ai_usage_events', 'provider_event_id', 'text', false),
    ('ai_usage_events', 'merchant_id', 'text', true),
    ('ai_usage_events', 'source', 'text', true),
    ('ai_usage_events', 'channel', 'text', true),
    ('ai_usage_events', 'component', 'text', true),
    ('ai_usage_events', 'provider', 'text', true),
    ('ai_usage_events', 'model', 'text', true),
    ('ai_usage_events', 'execution_status', 'text', true),
    ('ai_usage_events', 'prompt_tokens', 'integer', false),
    ('ai_usage_events', 'completion_tokens', 'integer', false),
    ('ai_usage_events', 'total_tokens', 'integer', false),
    ('ai_usage_events', 'cost_micros', 'bigint', false),
    ('ai_usage_events', 'currency', 'text', false),
    ('ai_usage_events', 'pricing_version', 'text', false),
    ('ai_usage_events', 'cost_status', 'text', true),
    ('ai_usage_events', 'started_at', 'timestamp(3) without time zone', true),
    ('ai_usage_events', 'completed_at', 'timestamp(3) without time zone', true),
    ('ai_usage_events', 'latency_ms', 'integer', true),
    ('ai_usage_events', 'conversation_id', 'text', false),
    ('ai_usage_events', 'voice_session_id', 'text', false),
    ('ai_usage_events', 'correlation_id', 'text', false),
    ('ai_usage_events', 'parent_usage_event_id', 'text', false),
    ('ai_usage_events', 'metadata', 'jsonb', false),
    ('ai_usage_events', 'captured_at', 'timestamp(3) without time zone', true),
    ('ai_price_versions', 'id', 'text', true),
    ('ai_price_versions', 'version', 'text', true),
    ('ai_price_versions', 'provider', 'text', true),
    ('ai_price_versions', 'model', 'text', true),
    ('ai_price_versions', 'channel', 'text', true),
    ('ai_price_versions', 'component', 'text', true),
    ('ai_price_versions', 'currency', 'text', true),
    ('ai_price_versions', 'input_micros_per_million', 'bigint', false),
    ('ai_price_versions', 'output_micros_per_million', 'bigint', false),
    ('ai_price_versions', 'effective_from', 'timestamp(3) without time zone', true),
    ('ai_price_versions', 'effective_to', 'timestamp(3) without time zone', false),
    ('ai_price_versions', 'source', 'text', true),
    ('ai_price_versions', 'created_at', 'timestamp(3) without time zone', true),
    ('revenue_analysis_schedules', 'merchant_id', 'text', true),
    ('revenue_analysis_schedules', 'timezone', 'text', true),
    ('revenue_analysis_schedules', 'group', 'integer', true),
    ('revenue_analysis_schedules', 'next_due_at', 'timestamp(3) without time zone', true),
    ('revenue_analysis_schedules', 'last_successful_at', 'timestamp(3) without time zone', false),
    ('revenue_analysis_schedules', 'current_run_id', 'text', false),
    ('revenue_analysis_schedules', 'cycle', 'integer', true),
    ('revenue_analysis_schedules', 'migrated_at', 'timestamp(3) without time zone', true),
    ('revenue_analysis_runs', 'id', 'text', true),
    ('revenue_analysis_runs', 'merchant_id', 'text', true),
    ('revenue_analysis_runs', 'cycle', 'integer', true),
    ('revenue_analysis_runs', 'status', 'text', true),
    ('revenue_analysis_runs', 'result', 'text', false),
    ('revenue_analysis_runs', 'reason', 'text', false),
    ('revenue_analysis_runs', 'attempts', 'integer', true),
    ('revenue_analysis_runs', 'lease_token', 'integer', true),
    ('revenue_analysis_runs', 'lease_until', 'timestamp(3) without time zone', false),
    ('revenue_analysis_runs', 'retry_at', 'timestamp(3) without time zone', true),
    ('revenue_analysis_runs', 'as_of', 'timestamp(3) without time zone', false),
    ('revenue_analysis_runs', 'observation_id', 'text', false),
    ('revenue_analysis_runs', 'hypothesis_id', 'text', false),
    ('revenue_analysis_runs', 'generated_json', 'jsonb', false),
    ('revenue_analysis_runs', 'created_at', 'timestamp(3) without time zone', true),
    ('revenue_analysis_runs', 'started_at', 'timestamp(3) without time zone', false),
    ('revenue_analysis_runs', 'completed_at', 'timestamp(3) without time zone', false),
    ('revenue_ai_reservations', 'id', 'text', true),
    ('revenue_ai_reservations', 'merchant_id', 'text', true),
    ('revenue_ai_reservations', 'run_id', 'text', true),
    ('revenue_ai_reservations', 'work_type', 'text', true),
    ('revenue_ai_reservations', 'provider', 'text', true),
    ('revenue_ai_reservations', 'model', 'text', true),
    ('revenue_ai_reservations', 'currency', 'text', true),
    ('revenue_ai_reservations', 'price_version', 'text', true),
    ('revenue_ai_reservations', 'input_rate', 'bigint', true),
    ('revenue_ai_reservations', 'output_rate', 'bigint', true),
    ('revenue_ai_reservations', 'max_input_tokens', 'integer', true),
    ('revenue_ai_reservations', 'max_output_tokens', 'integer', true),
    ('revenue_ai_reservations', 'amount_micros', 'bigint', true),
    ('revenue_ai_reservations', 'state', 'text', true),
    ('revenue_ai_reservations', 'usage_key', 'text', true),
    ('revenue_ai_reservations', 'created_at', 'timestamp(3) without time zone', true),
    ('revenue_ai_reservations', 'settled_at', 'timestamp(3) without time zone', false)
  )
  SELECT string_agg(r.table_name || '.' || r.column_name, ', ' ORDER BY r.table_name, r.column_name)
  INTO problem
  FROM required r
  LEFT JOIN pg_namespace n ON n.nspname = current_schema()
  LEFT JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = r.table_name
  LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = r.column_name AND a.attnum > 0 AND NOT a.attisdropped
  WHERE t.relkind IS DISTINCT FROM 'r' OR a.attname IS NULL
    OR format_type(a.atttypid, a.atttypmod) IS DISTINCT FROM r.type_name
    OR a.attnotnull IS DISTINCT FROM r.not_null;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'REVENUE_FOUNDATION_INCOMPATIBLE_COLUMNS: %', problem;
  END IF;
  WITH required(table_name, column_name, allowed_defaults) AS (VALUES
    ('ai_usage_events', 'cost_status', ARRAY['''unpriced''::text']),
    ('ai_usage_events', 'captured_at', ARRAY['CURRENT_TIMESTAMP', 'now()']),
    ('ai_price_versions', 'created_at', ARRAY['CURRENT_TIMESTAMP', 'now()']),
    ('revenue_analysis_schedules', 'timezone', ARRAY['''America/Sao_Paulo''::text']),
    ('revenue_analysis_schedules', 'cycle', ARRAY['0']),
    ('revenue_analysis_schedules', 'migrated_at', ARRAY['CURRENT_TIMESTAMP', 'now()']),
    ('revenue_analysis_runs', 'status', ARRAY['''queued''::text']),
    ('revenue_analysis_runs', 'attempts', ARRAY['0']),
    ('revenue_analysis_runs', 'lease_token', ARRAY['0']),
    ('revenue_analysis_runs', 'retry_at', ARRAY['CURRENT_TIMESTAMP', 'now()']),
    ('revenue_analysis_runs', 'created_at', ARRAY['CURRENT_TIMESTAMP', 'now()']),
    ('revenue_ai_reservations', 'state', ARRAY['''dispatched''::text']),
    ('revenue_ai_reservations', 'created_at', ARRAY['CURRENT_TIMESTAMP', 'now()'])
  )
  SELECT string_agg(r.table_name || '.' || r.column_name, ', ' ORDER BY r.table_name, r.column_name)
  INTO problem
  FROM required r
  JOIN pg_namespace n ON n.nspname = current_schema()
  JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = r.table_name
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = r.column_name
  LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
  WHERE d.oid IS NULL OR NOT (pg_get_expr(d.adbin, d.adrelid) = ANY(r.allowed_defaults));
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'REVENUE_FOUNDATION_INCOMPATIBLE_DEFAULTS: %', problem;
  END IF;
END $foundation_columns$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_events_idempotency_key_key" ON "ai_usage_events"("idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_usage_events_merchant_id_started_at_idx" ON "ai_usage_events"("merchant_id", "started_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_usage_events_merchant_id_channel_started_at_idx" ON "ai_usage_events"("merchant_id", "channel", "started_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_usage_events_provider_provider_event_id_idx" ON "ai_usage_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_usage_events_conversation_id_started_at_idx" ON "ai_usage_events"("conversation_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ai_price_versions_version_key" ON "ai_price_versions"("version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_price_versions_provider_model_channel_component_effectiv_idx" ON "ai_price_versions"("provider", "model", "channel", "component", "effective_from");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "revenue_analysis_schedules_next_due_at_merchant_id_idx" ON "revenue_analysis_schedules"("next_due_at", "merchant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "revenue_analysis_runs_status_retry_at_created_at_idx" ON "revenue_analysis_runs"("status", "retry_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_analysis_runs_merchant_id_cycle_key" ON "revenue_analysis_runs"("merchant_id", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_ai_reservations_usage_key_key" ON "revenue_ai_reservations"("usage_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "revenue_ai_reservations_currency_created_at_idx" ON "revenue_ai_reservations"("currency", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "revenue_ai_reservations_run_id_idx" ON "revenue_ai_reservations"("run_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "revenue_ai_reservations_provider_model_state_created_at_idx" ON "revenue_ai_reservations"("provider", "model", "state", "created_at");


-- IF NOT EXISTS alone does not establish that an existing index enforces the
-- expected uniqueness or indexes the correct columns. Check all definitions.
DO $foundation_indexes$
DECLARE problem text;
BEGIN
  WITH required(index_name, table_name, columns, is_unique, is_primary) AS (VALUES
    ('ai_usage_events_pkey', 'ai_usage_events', ARRAY['id'], true, true),
    ('ai_price_versions_pkey', 'ai_price_versions', ARRAY['id'], true, true),
    ('revenue_analysis_schedules_pkey', 'revenue_analysis_schedules', ARRAY['merchant_id'], true, true),
    ('revenue_analysis_runs_pkey', 'revenue_analysis_runs', ARRAY['id'], true, true),
    ('revenue_ai_reservations_pkey', 'revenue_ai_reservations', ARRAY['id'], true, true),
    ('ai_usage_events_idempotency_key_key', 'ai_usage_events', ARRAY['idempotency_key'], true, false),
    ('ai_usage_events_merchant_id_started_at_idx', 'ai_usage_events', ARRAY['merchant_id', 'started_at'], false, false),
    ('ai_usage_events_merchant_id_channel_started_at_idx', 'ai_usage_events', ARRAY['merchant_id', 'channel', 'started_at'], false, false),
    ('ai_usage_events_provider_provider_event_id_idx', 'ai_usage_events', ARRAY['provider', 'provider_event_id'], false, false),
    ('ai_usage_events_conversation_id_started_at_idx', 'ai_usage_events', ARRAY['conversation_id', 'started_at'], false, false),
    ('ai_price_versions_version_key', 'ai_price_versions', ARRAY['version'], true, false),
    ('ai_price_versions_provider_model_channel_component_effectiv_idx', 'ai_price_versions', ARRAY['provider', 'model', 'channel', 'component', 'effective_from'], false, false),
    ('revenue_analysis_schedules_next_due_at_merchant_id_idx', 'revenue_analysis_schedules', ARRAY['next_due_at', 'merchant_id'], false, false),
    ('revenue_analysis_runs_status_retry_at_created_at_idx', 'revenue_analysis_runs', ARRAY['status', 'retry_at', 'created_at'], false, false),
    ('revenue_analysis_runs_merchant_id_cycle_key', 'revenue_analysis_runs', ARRAY['merchant_id', 'cycle'], true, false),
    ('revenue_ai_reservations_usage_key_key', 'revenue_ai_reservations', ARRAY['usage_key'], true, false),
    ('revenue_ai_reservations_currency_created_at_idx', 'revenue_ai_reservations', ARRAY['currency', 'created_at'], false, false),
    ('revenue_ai_reservations_run_id_idx', 'revenue_ai_reservations', ARRAY['run_id'], false, false),
    ('revenue_ai_reservations_provider_model_state_created_at_idx', 'revenue_ai_reservations', ARRAY['provider', 'model', 'state', 'created_at'], false, false)
  )
  SELECT string_agg(r.index_name, ', ' ORDER BY r.index_name) INTO problem
  FROM required r
  LEFT JOIN pg_namespace n ON n.nspname = current_schema()
  LEFT JOIN pg_class t ON t.relnamespace = n.oid AND t.relname = r.table_name
  LEFT JOIN pg_class x ON x.relnamespace = n.oid AND x.relname = r.index_name
  LEFT JOIN pg_index i ON i.indexrelid = x.oid AND i.indrelid = t.oid
  LEFT JOIN pg_am am ON am.oid = x.relam
  WHERE i.indexrelid IS NULL OR NOT i.indisvalid OR NOT i.indisready
    OR i.indisunique IS DISTINCT FROM r.is_unique OR i.indisprimary IS DISTINCT FROM r.is_primary
    OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL OR am.amname IS DISTINCT FROM 'btree'
    OR ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum ORDER BY k.position) IS DISTINCT FROM r.columns;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'REVENUE_FOUNDATION_INCOMPATIBLE_INDEXES: %', problem;
  END IF;
END $foundation_indexes$;

COMMIT;
