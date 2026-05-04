-- Adds persistent chat history per checkout session and theme JSON per merchant.
ALTER TABLE "checkout_sessions"
  ADD COLUMN IF NOT EXISTS "chat_history" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "merchants"
  ADD COLUMN IF NOT EXISTS "theme" JSONB;
