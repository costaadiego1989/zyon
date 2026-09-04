import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST!;
const MID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

// Stripe test-mode "instant verification" values — these make a Custom account
// pass verification immediately. See https://docs.stripe.com/connect/testing
const params: Record<string, string> = {
  type: "custom",
  country: "BR",
  email: "costaadiego1989@gmail.com",
  business_type: "individual",
  "capabilities[card_payments][requested]": "true",
  "capabilities[transfers][requested]": "true",
  "individual[first_name]": "Diego",
  "individual[last_name]": "Costa",
  "individual[email]": "costaadiego1989@gmail.com",
  "individual[phone]": "+5521993001883",
  "individual[id_number]": "000000000",
  "individual[dob][day]": "1",
  "individual[dob][month]": "1",
  "individual[dob][year]": "1901",
  "individual[address][line1]": "address_full_match",
  "individual[address][city]": "Teresopolis",
  "individual[address][state]": "RJ",
  "individual[address][postal_code]": "25958180",
  "individual[political_exposure]": "none",
  "business_profile[mcc]": "5734",
  "business_profile[product_description]": "E-commerce checkout",
  "business_profile[url]": "https://athom.tech",
  "external_account[object]": "bank_account",
  "external_account[country]": "BR",
  "external_account[currency]": "brl",
  "external_account[routing_number]": "110-0000",
  "external_account[account_number]": "0001234",
  "tos_acceptance[date]": "1787000000",
  "tos_acceptance[ip]": "189.6.42.10",
  "metadata[merchant_id]": MID,
};

const res = await fetch("https://api.stripe.com/v1/accounts", {
  method: "POST",
  headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(params).toString(),
});
const acct = await res.json();

if (acct.error) {
  console.error("ERROR:", acct.error.message, "| param:", acct.error.param);
  process.exit(1);
}

console.log("Account:", acct.id);
console.log("charges_enabled:", acct.charges_enabled);
console.log("card_payments:", acct.capabilities?.card_payments);
console.log("requirements.currently_due:", JSON.stringify(acct.requirements?.currently_due));
console.log("requirements.pending:", JSON.stringify(acct.requirements?.pending_verification));

// Save to DB
const p = createPrismaClient();
await (p as any).merchantPaymentConnection.update({
  where: { merchantId_provider: { merchantId: MID, provider: "stripe" } },
  data: {
    status: acct.charges_enabled ? "active" : "restricted",
    externalAccountId: acct.id,
    chargesEnabled: acct.charges_enabled,
    payoutsEnabled: acct.payouts_enabled,
    environment: "test",
    lastSyncedAt: new Date(),
  },
});
console.log(`\n✓ DB updated: account=${acct.id} status=${acct.charges_enabled ? "active" : "restricted"}`);
await p.$disconnect();
