/**
 * One-time script to create Stripe Products and Prices for AACP billing plans.
 *
 * Run: cd apps/api && npx tsx scripts/setup-stripe-billing.ts
 *
 * After running, copy the output env vars to your .env file.
 * Only needs to run ONCE per Stripe account (test or live).
 */

import Stripe from "stripe";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const secretKey = process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error("ERROR: Set STRIPE_SECRET_KEY_TEST or STRIPE_SECRET_KEY in .env");
  process.exit(1);
}

const stripe = new Stripe(secretKey);

const PLANS = [
  { key: "starter", name: "AACP Starter", priceInCents: 0, description: "Grátis — 100 pedidos/mês, 2.49% taxa" },
  { key: "growth", name: "AACP Growth", priceInCents: 24900, description: "R$249/mês — 500 pedidos, 1.99% taxa" },
  { key: "scale", name: "AACP Scale", priceInCents: 59900, description: "R$599/mês — ilimitado, 1.49% taxa" },
] as const;

async function main() {
  console.log("Creating Stripe Products and Prices...\n");
  console.log("# Add these to apps/api/.env:");
  console.log("# ─────────────────────────────────────────");

  for (const plan of PLANS) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { aacp_plan: plan.key },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.priceInCents,
      currency: "brl",
      recurring: { interval: "month" },
      metadata: { aacp_plan: plan.key },
    });

    const envKey = `STRIPE_BILLING_PRICE_${plan.key.toUpperCase()}`;
    console.log(`${envKey}=${price.id}`);
  }

  console.log("\n# Done! Paste the lines above into apps/api/.env");
  console.log("# Then restart the API server.");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
