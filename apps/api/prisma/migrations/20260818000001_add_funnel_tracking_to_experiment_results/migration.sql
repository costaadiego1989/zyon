-- Add funnel tracking fields to PromptVariantResult
ALTER TABLE "prompt_variant_results" ADD COLUMN "conversation_started" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "prompt_variant_results" ADD COLUMN "cart_viewed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "prompt_variant_results" ADD COLUMN "cart_items_added" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "prompt_variant_results" ADD COLUMN "checkout_started" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "prompt_variant_results" ADD COLUMN "checkout_completed" BOOLEAN NOT NULL DEFAULT false;

-- Stage timing (seconds from session start)
ALTER TABLE "prompt_variant_results" ADD COLUMN "time_to_cart" INTEGER;
ALTER TABLE "prompt_variant_results" ADD COLUMN "time_to_checkout" INTEGER;
ALTER TABLE "prompt_variant_results" ADD COLUMN "time_to_conversion" INTEGER;

-- Create index for funnel analysis queries
CREATE INDEX "idx_prompt_variant_results_funnel" ON "prompt_variant_results"("variant_id", "checkout_completed", "created_at");
