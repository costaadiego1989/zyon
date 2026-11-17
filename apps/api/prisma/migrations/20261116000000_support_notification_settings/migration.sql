BEGIN;

CREATE TABLE "support_notification_settings" (
    "merchant_id" TEXT NOT NULL,
    "fallback_whatsapp" VARCHAR(16),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_notification_settings_pkey" PRIMARY KEY ("merchant_id"),
    CONSTRAINT "support_notification_settings_version_check" CHECK ("version" > 0),
    CONSTRAINT "support_notification_settings_phone_check" CHECK (
        "fallback_whatsapp" IS NULL OR "fallback_whatsapp" ~ '^[+][1-9][0-9]{7,14}$'
    ),
    CONSTRAINT "support_notification_settings_merchant_id_fkey" FOREIGN KEY ("merchant_id")
        REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

COMMIT;
