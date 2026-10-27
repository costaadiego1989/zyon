import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST!;
const NGROK = "https://punctate-daxton-demagogically.ngrok-free.dev";

// List existing webhook endpoints
const listRes = await fetch("https://api.stripe.com/v1/webhook_endpoints", {
  headers: { Authorization: `Bearer ${STRIPE_KEY}` },
});
const existing = await listRes.json();
console.log("Existing endpoints:");
for (const e of existing.data ?? []) console.log(`  ${e.id} | ${e.url} | ${e.status}`);

// Check if ngrok endpoint already exists
const ngrokUrl = `${NGROK}/webhooks/stripe`;
const already = (existing.data ?? []).find((e: any) => e.url === ngrokUrl);
if (already) {
  console.log(`\nEndpoint already exists: ${already.id}`);
  console.log("(secret only shown at creation; using STRIPE_WEBHOOK_SECRET_TEST from .env)");
  process.exit(0);
}

// Create new endpoint
const res = await fetch("https://api.stripe.com/v1/webhook_endpoints", {
  method: "POST",
  headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    url: ngrokUrl,
    "enabled_events[]": "payment_intent.succeeded",
    "enabled_events[1]": "payment_intent.payment_failed",
    "enabled_events[2]": "charge.succeeded",
    "enabled_events[3]": "account.updated",
    description: "AACP local dev (ngrok)",
  }).toString(),
});
const wh = await res.json();
if (wh.error) { console.error("Error:", wh.error.message); process.exit(1); }
console.log("\n✓ Created webhook endpoint:", wh.id);
console.log("URL:", wh.url);
console.log("SIGNING SECRET:", wh.secret);
console.log("\n⚠ Update .env: STRIPE_WEBHOOK_SECRET_TEST=" + wh.secret);
