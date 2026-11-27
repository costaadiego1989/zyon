-- Match the current Product defaults without changing already configured flags.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "advanced_content_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "testimonials_visible" BOOLEAN NOT NULL DEFAULT false;
