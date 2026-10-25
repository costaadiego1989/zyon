-- CreateTable
CREATE TABLE "nav_badge_views" (
    "merchant_id" TEXT NOT NULL,
    "badge_key" TEXT NOT NULL,
    "last_viewed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_badge_views_pkey" PRIMARY KEY ("merchant_id","badge_key")
);
