-- Preserve the currently public legacy surface. Explicit merchant saves take
-- precedence after release. New products require testimonial opt-in.
ALTER TABLE "products" ADD COLUMN "advanced_content_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN "testimonials_visible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ALTER COLUMN "testimonials_visible" SET DEFAULT false;
