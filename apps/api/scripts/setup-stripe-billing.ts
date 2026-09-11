/** Idempotent price provisioning. Dry run by default; never changes subscriptions.
 * node --experimental-strip-types scripts/setup-stripe-billing.ts --plan growth [--apply]
 * Build @zyon/shared-types first. Railway runtime env takes precedence over .env.
 */
import Stripe from "stripe";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { BILLING_PLANS } from "@zyon/shared-types";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
const args = process.argv.slice(2);
const key = args[args.indexOf("--plan") + 1];
if (!args.includes("--plan") || (key !== "growth" && key !== "scale")) throw new Error("Use --plan growth|scale. Free does not need a Stripe price.");
const apply = args.includes("--apply");
const secret = process.env.NODE_ENV === "production" ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_KEY_TEST;
if (!secret) throw new Error("Configure the Stripe key for the selected NODE_ENV.");
const stripe = new Stripe(secret);
const plan = BILLING_PLANS[key];
const envKey = `STRIPE_BILLING_PRICE_${key.toUpperCase()}`;
const previousId = process.env[envKey]?.trim();
const previous = previousId ? await stripe.prices.retrieve(previousId) : undefined;
const known = (p: Stripe.Product) => (p.metadata.zyon_billing_plan ?? p.metadata.aacp_plan) === key;
let product: Stripe.Product | undefined;
if (previous) {
  const p = await stripe.products.retrieve(typeof previous.product === "string" ? previous.product : previous.product.id);
  if (p.deleted || !known(p)) throw new Error("Configured price product does not match the requested Zyon plan.");
  product = p;
} else {
  const matches: Stripe.Product[] = [];
  for await (const p of stripe.products.list({ limit: 100 })) if (known(p) && p.active) matches.push(p);
  if (matches.length > 1) throw new Error("Multiple products match; set the current price env explicitly.");
  product = matches[0];
}
const amount = Math.round(plan.monthlyPriceBrl * 100);
if (!product && apply) product = await stripe.products.create({ name: `Zyon ${plan.name}`, metadata: { zyon_billing_plan: key } }, { idempotencyKey: `zyon-billing-product-${key}` });
let price: Stripe.Price | undefined;
if (product) for await (const p of stripe.prices.list({ product: product.id, active: true, limit: 100 })) {
  if (p.unit_amount === amount && p.currency === "brl" && p.recurring?.interval === "month" && p.recurring.interval_count === 1 && p.recurring.usage_type === "licensed") { price = p; break; }
}
if (!price && apply && product) price = await stripe.prices.create({ product: product.id, unit_amount: amount, currency: "brl", recurring: { interval: "month" }, metadata: { zyon_billing_plan: key } }, { idempotencyKey: `zyon-billing-${product.id}-brl-month-${amount}` });
const legacy = new Set((process.env[`${envKey}_LEGACY`] ?? "").split(",").map(v => v.trim()).filter(Boolean));
if (previousId && previousId !== price?.id) legacy.add(previousId);
console.log(JSON.stringify({ mode: apply ? "apply-prices-only" : "dry-run", plan: key, monthlyPriceBrl: plan.monthlyPriceBrl, product: product?.id, previousPrice: previousId, price: price?.id, createPrice: !price, live: price?.livemode ?? previous?.livemode, subscriptionsChanged: 0, envPatch: price ? { [envKey]: price.id, [`${envKey}_LEGACY`]: [...legacy].join(",") } : undefined }, null, 2));
