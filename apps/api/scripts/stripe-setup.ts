import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST!;
const NGROK_URL = "https://punctate-daxton-demagogically.ngrok-free.dev";

async function stripeGet(path: string) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  return res.json();
}

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

// 1. Check existing account status
const acctId = "acct_1U4ByVLXuUaROxMi";
console.log("=== CHECKING ACCOUNT", acctId, "===");
const acct = await stripeGet(`/accounts/${acctId}`);
console.log("charges_enabled:", acct.charges_enabled);
console.log("payouts_enabled:", acct.payouts_enabled);
console.log("details_submitted:", acct.details_submitted);
console.log("requirements:", JSON.stringify(acct.requirements?.currently_due?.slice(0, 5)));

// 2. If not charges_enabled, check if we can use the newer account
const acctNew = "acct_1U8sCSLDzqyNXxzO";
console.log("\n=== CHECKING ACCOUNT", acctNew, "===");
const acctN = await stripeGet(`/accounts/${acctNew}`);
console.log("charges_enabled:", acctN.charges_enabled);
console.log("payouts_enabled:", acctN.payouts_enabled);
console.log("details_submitted:", acctN.details_submitted);
console.log("requirements:", JSON.stringify(acctN.requirements?.currently_due?.slice(0, 5)));

// 3. Create webhook endpoint for the ngrok URL
console.log("\n=== CREATING WEBHOOK ENDPOINT ===");
const webhook = await stripePost("/webhook_endpoints", {
  url: `${NGROK_URL}/webhooks/stripe`,
  "enabled_events[]": "payment_intent.succeeded",
  "enabled_events[1]": "payment_intent.payment_failed",
  "enabled_events[2]": "account.updated",
  "enabled_events[3]": "charge.succeeded",
  description: "AACP local dev (ngrok)",
});
if (webhook.error) {
  console.error("Webhook error:", webhook.error.message);
} else {
  console.log("Webhook ID:", webhook.id);
  console.log("Webhook secret:", webhook.secret);
  console.log("URL:", webhook.url);
}
