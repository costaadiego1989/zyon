import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST!;
const NGROK_URL = "https://punctate-daxton-demagogically.ngrok-free.dev";
const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

async function stripePost(path: string, body: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

// 1. Create Connected Account (Express type)
console.log("Creating Stripe Connected Account...");
const account = await stripePost("/accounts", {
  type: "express",
  country: "BR",
  email: "costaadiego1989@gmail.com",
  "business_type": "individual",
  "capabilities[card_payments][requested]": "true",
  "capabilities[transfers][requested]": "true",
  "metadata[merchant_id]": MERCHANT_ID,
});

if (account.error) {
  console.error("Error creating account:", account.error.message);
  process.exit(1);
}
console.log("Account created:", account.id);

// 2. Create Account Link (onboarding URL)
console.log("Generating onboarding link...");
const link = await stripePost("/account_links", {
  account: account.id,
  refresh_url: `${NGROK_URL}/settings/payments/stripe/refresh`,
  return_url: `${NGROK_URL}/settings/payments/stripe/return`,
  type: "account_onboarding",
});

if (link.error) {
  console.error("Error creating link:", link.error.message);
  process.exit(1);
}

console.log("\n==============================================");
console.log("STRIPE ONBOARDING LINK (abra no navegador):");
console.log(link.url);
console.log("==============================================");
console.log("\nAccount ID:", account.id);
console.log("Expires at:", new Date(link.expires_at * 1000).toLocaleString());

// 3. Save to DB (update merchant payment connection)
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
const p = createPrismaClient();
await (p as any).merchantPaymentConnection.upsert({
  where: { merchantId_provider: { merchantId: MERCHANT_ID, provider: "stripe" } },
  create: {
    merchantId: MERCHANT_ID,
    provider: "stripe",
    externalAccountId: account.id,
    environment: "test",
    status: "restricted", // will become active after onboarding
    chargesEnabled: false,
    payoutsEnabled: false,
  },
  update: {
    externalAccountId: account.id,
    environment: "test",
    status: "restricted",
  },
});
console.log("\n✓ Saved to DB (status=restricted until onboarding complete)");
await p.$disconnect();
