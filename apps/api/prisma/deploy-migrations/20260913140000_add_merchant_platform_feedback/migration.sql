CREATE TABLE "merchant_platform_feedback" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_platform_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "merchant_platform_feedback_merchant_id_created_at_idx"
ON "merchant_platform_feedback"("merchant_id", "created_at");

CREATE INDEX "merchant_platform_feedback_category_created_at_idx"
ON "merchant_platform_feedback"("category", "created_at");
