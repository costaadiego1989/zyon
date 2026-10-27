-- Proposal versions and accepted decisions are audit evidence. Never rewrite them.
CREATE FUNCTION reject_revenue_strategy_evidence_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'REVENUE_STRATEGY_EVIDENCE_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

-- CreateTable
CREATE TABLE "revenue_strategies" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_strategy_versions" (
    "strategy_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "proposal_hash" TEXT NOT NULL,
    "proposal" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_strategy_versions_pkey" PRIMARY KEY ("strategy_id","merchant_id","version")
);

-- CreateTable
CREATE TABLE "revenue_strategy_actions" (
    "id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "feedback" TEXT,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_strategy_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_strategy_revisions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMP(3),
    "retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_json" JSONB,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "revenue_strategy_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revenue_strategies_merchant_id_created_at_id_idx" ON "revenue_strategies"("merchant_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_strategies_id_merchant_id_key" ON "revenue_strategies"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_strategies_merchant_id_run_id_key" ON "revenue_strategies"("merchant_id", "run_id");

-- CreateIndex
CREATE INDEX "revenue_strategy_actions_strategy_id_merchant_id_created_at_idx" ON "revenue_strategy_actions"("strategy_id", "merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_strategy_action_request_key" ON "revenue_strategy_actions"("strategy_id", "merchant_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_strategy_actions_id_merchant_id_key" ON "revenue_strategy_actions"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "revenue_strategy_revisions_status_retry_at_id_idx" ON "revenue_strategy_revisions"("status", "retry_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_strategy_revisions_id_merchant_id_key" ON "revenue_strategy_revisions"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_analysis_runs_id_merchant_id_key" ON "revenue_analysis_runs"("id", "merchant_id");

-- AddForeignKey
ALTER TABLE "revenue_strategies" ADD CONSTRAINT "revenue_strategies_run_id_merchant_id_fkey" FOREIGN KEY ("run_id", "merchant_id") REFERENCES "revenue_analysis_runs"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_strategy_versions" ADD CONSTRAINT "revenue_strategy_versions_strategy_id_merchant_id_fkey" FOREIGN KEY ("strategy_id", "merchant_id") REFERENCES "revenue_strategies"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_strategy_actions" ADD CONSTRAINT "revenue_strategy_actions_strategy_id_merchant_id_version_fkey" FOREIGN KEY ("strategy_id", "merchant_id", "version") REFERENCES "revenue_strategy_versions"("strategy_id", "merchant_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_strategy_revisions" ADD CONSTRAINT "revenue_strategy_revisions_id_merchant_id_fkey" FOREIGN KEY ("id", "merchant_id") REFERENCES "revenue_strategy_actions"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER revenue_strategy_versions_immutable BEFORE UPDATE OR DELETE ON revenue_strategy_versions
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();
CREATE TRIGGER revenue_strategy_actions_immutable BEFORE UPDATE OR DELETE ON revenue_strategy_actions
  FOR EACH ROW EXECUTE FUNCTION reject_revenue_strategy_evidence_change();
