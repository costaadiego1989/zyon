-- Additive only: no historical usage or financial values are rewritten.
CREATE TABLE "ai_governance_policy_revisions" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL, "grants" JSONB NOT NULL, "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ai_governance_policy_revisions_merchant_id_version_key" ON "ai_governance_policy_revisions"("merchant_id","version");
ALTER TABLE "ai_usage_events" ADD COLUMN "actor_id" TEXT, ADD COLUMN "actor_role" TEXT, ADD COLUMN "team_id" TEXT, ADD COLUMN "task_id" TEXT;
CREATE INDEX "ai_usage_events_merchant_team_started_idx" ON "ai_usage_events" ("merchant_id","team_id","started_at");
CREATE INDEX "ai_usage_events_task_idx" ON "ai_usage_events" ("task_id");
CREATE TABLE "ai_governance_policies" (
  "merchant_id" TEXT PRIMARY KEY REFERENCES "merchants"("id") ON DELETE CASCADE,
  "grants" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "updated_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ai_governance_decisions" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "actor_id" TEXT, "actor_role" TEXT NOT NULL, "team_id" TEXT, "source" TEXT NOT NULL,
  "resource_kind" TEXT NOT NULL, "resource" TEXT NOT NULL, "allowed" BOOLEAN NOT NULL, "reason" TEXT NOT NULL,
  "policy_version" INTEGER, "correlation_id" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ai_governance_decisions_merchant_id_created_at_idx" ON "ai_governance_decisions"("merchant_id","created_at");
CREATE INDEX "ai_governance_decisions_merchant_id_allowed_created_at_idx" ON "ai_governance_decisions"("merchant_id","allowed","created_at");
CREATE TABLE "ai_actor_teams" (
  "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE, "actor_id" TEXT NOT NULL,
  "team_id" TEXT NOT NULL, "updated_by" TEXT NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("merchant_id","actor_id")
);
CREATE TABLE "ai_task_baselines" (
  "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE, "task_type" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "human_ms" INTEGER NOT NULL CHECK ("human_ms" > 0 AND "human_ms" <= 86400000),
  "sample_size" INTEGER NOT NULL CHECK ("sample_size" >= 1), "updated_by" TEXT NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("merchant_id","task_type")
);
CREATE TABLE "ai_automation_tasks" (
  "id" TEXT PRIMARY KEY, "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "actor_id" TEXT, "actor_role" TEXT NOT NULL, "team_id" TEXT, "source" TEXT NOT NULL, "task_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "baseline_version" INTEGER, "baseline_human_ms" INTEGER,
  "observed_human_ms" INTEGER CHECK ("observed_human_ms" >= 0 AND "observed_human_ms" <= 86400000),
  "observation_by" TEXT, "observation_at" TIMESTAMP(3), "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3), "elapsed_ms" INTEGER
);
CREATE INDEX "ai_automation_tasks_merchant_id_started_at_idx" ON "ai_automation_tasks"("merchant_id","started_at");
CREATE INDEX "ai_automation_tasks_merchant_id_team_id_started_at_idx" ON "ai_automation_tasks"("merchant_id","team_id","started_at");
