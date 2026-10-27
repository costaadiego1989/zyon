CREATE TABLE IF NOT EXISTS merchant_notifications (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  metadata JSONB,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mn_merchant_created ON merchant_notifications(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mn_merchant_read ON merchant_notifications(merchant_id, read);
