-- Preserve historical attempts while adding a durable, tenant-scoped dispatch claim.
CREATE TABLE "recovery_attempt_claims" (
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_attempt_claims_pkey" PRIMARY KEY ("merchant_id", "session_id"),
    CONSTRAINT "recovery_attempt_claims_attempt_id_key" UNIQUE ("attempt_id"),
    CONSTRAINT "recovery_attempt_claims_attempt_id_fkey"
      FOREIGN KEY ("attempt_id") REFERENCES "recovery_attempts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

-- Existing duplicate history remains auditable. The oldest attempt prevents a
-- legacy session from being dispatched again after this migration is deployed.
INSERT INTO "recovery_attempt_claims" ("merchant_id", "session_id", "attempt_id", "created_at")
SELECT DISTINCT ON ("merchant_id", "session_id")
  "merchant_id", "session_id", "id", "created_at"
FROM "recovery_attempts"
ORDER BY "merchant_id", "session_id", "created_at" ASC, "id" ASC;
