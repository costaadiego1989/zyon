CREATE TABLE "ai_price_versions" (
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

CREATE UNIQUE INDEX "ai_price_versions_version_key" ON "ai_price_versions"("version");
CREATE INDEX "ai_price_versions_provider_model_channel_component_effective_from_idx"
  ON "ai_price_versions"("provider", "model", "channel", "component", "effective_from");

INSERT INTO "ai_price_versions" (
  "id", "version", "provider", "model", "channel", "component", "currency",
  "input_micros_per_million", "output_micros_per_million", "effective_from", "source"
) VALUES
  ('aiprice_openrouter_claude_sonnet_4_202607', 'openrouter-claude-sonnet-4-2026-07', 'openrouter.ai', 'anthropic/claude-sonnet-4', 'chat', 'text_generation', 'USD', 3000000, 15000000, TIMESTAMP '2026-07-01 00:00:00', 'legacy_cost_tracker_2026_07'),
  ('aiprice_openrouter_claude_35_sonnet_202607', 'openrouter-claude-3-5-sonnet-2026-07', 'openrouter.ai', 'anthropic/claude-3.5-sonnet', 'chat', 'text_generation', 'USD', 3000000, 15000000, TIMESTAMP '2026-07-01 00:00:00', 'legacy_cost_tracker_2026_07'),
  ('aiprice_openrouter_gpt_4o_mini_202607', 'openrouter-gpt-4o-mini-2026-07', 'openrouter.ai', 'openai/gpt-4o-mini', 'chat', 'text_generation', 'USD', 150000, 600000, TIMESTAMP '2026-07-01 00:00:00', 'legacy_cost_tracker_2026_07'),
  ('aiprice_openrouter_gpt_4o_202607', 'openrouter-gpt-4o-2026-07', 'openrouter.ai', 'openai/gpt-4o', 'chat', 'text_generation', 'USD', 5000000, 15000000, TIMESTAMP '2026-07-01 00:00:00', 'legacy_cost_tracker_2026_07');
