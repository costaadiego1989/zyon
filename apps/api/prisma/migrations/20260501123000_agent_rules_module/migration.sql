CREATE TABLE "agent_rules" (
  "id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "user_id" TEXT,
  "scope" TEXT NOT NULL,
  "identity" JSONB NOT NULL,
  "capabilities" JSONB NOT NULL,
  "guardrails" JSONB NOT NULL,
  "checkout_settings" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_rules_merchant_id_agent_id_key" ON "agent_rules"("merchant_id", "agent_id");
CREATE UNIQUE INDEX "agent_rules_merchant_id_user_id_scope_key" ON "agent_rules"("merchant_id", "user_id", "scope");
CREATE INDEX "agent_rules_merchant_id_user_id_idx" ON "agent_rules"("merchant_id", "user_id");

ALTER TABLE "agent_rules" ADD CONSTRAINT "agent_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "merchant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
