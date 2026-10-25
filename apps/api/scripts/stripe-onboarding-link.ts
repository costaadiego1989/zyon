import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST!;
const NGROK = "https://punctate-daxton-demagogically.ngrok-free.dev";

const res = await fetch("https://api.stripe.com/v1/account_links", {
  method: "POST",
  headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    account: "acct_1U4ByVLXuUaROxMi",
    refresh_url: `${NGROK}/settings/payments/stripe/refresh`,
    return_url: `${NGROK}/settings/payments/stripe/return`,
    type: "account_onboarding",
  }).toString(),
});
const link = await res.json();
console.log("ONBOARDING LINK:", link.url);
console.log("Expires:", new Date(link.expires_at * 1000).toLocaleString());
