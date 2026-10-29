CREATE TABLE "merchants" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_users" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "merchant_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merchant_users_email_key" ON "merchant_users"("email");
CREATE INDEX "merchant_users_merchant_id_idx" ON "merchant_users"("merchant_id");

ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
