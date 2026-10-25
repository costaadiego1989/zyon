import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST!;
const ACCT = "acct_1U8syCLnjGWYt6MG";
const MID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

// Stripe test mode: uploading a file with name containing "success" triggers instant verification
// Step 1: Upload a test identity document
// Minimal valid 1x1 PNG (67 bytes)
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const formData = new FormData();
formData.append("purpose", "identity_document");
const fileContent = new Blob([PNG_1x1], { type: "image/png" });
formData.append("file", fileContent, "success_document.png");

const uploadRes = await fetch("https://files.stripe.com/v1/files", {
  method: "POST",
  headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  body: formData,
});
const file = await uploadRes.json();
if (file.error) { console.error("File upload error:", file.error.message); process.exit(1); }
console.log("File uploaded:", file.id);

// Step 2: Attach the document to the person
const personRes = await fetch(`https://api.stripe.com/v1/accounts/${ACCT}/persons`, {
  headers: { Authorization: `Bearer ${STRIPE_KEY}` },
});
const persons = await personRes.json();
const personId = persons.data?.[0]?.id;
console.log("Person:", personId);

if (personId) {
  const updateRes = await fetch(`https://api.stripe.com/v1/accounts/${ACCT}/persons/${personId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "verification[document][front]": file.id,
      "verification[additional_document][front]": file.id,
    }).toString(),
  });
  const updated = await updateRes.json();
  if (updated.error) console.error("Person update error:", updated.error.message);
  else console.log("Person document attached");
}

// Step 3: Wait a moment and re-check
await new Promise(r => setTimeout(r, 3000));
const acctRes = await fetch(`https://api.stripe.com/v1/accounts/${ACCT}`, {
  headers: { Authorization: `Bearer ${STRIPE_KEY}` },
});
const acct = await acctRes.json();
console.log("\nAfter doc upload:");
console.log("charges_enabled:", acct.charges_enabled);
console.log("card_payments:", acct.capabilities?.card_payments);
console.log("pending:", JSON.stringify(acct.requirements?.pending_verification));
console.log("currently_due:", JSON.stringify(acct.requirements?.currently_due));

if (acct.charges_enabled) {
  const p = createPrismaClient();
  await (p as any).merchantPaymentConnection.update({
    where: { merchantId_provider: { merchantId: MID, provider: "stripe" } },
    data: { status: "active", chargesEnabled: true, lastSyncedAt: new Date() },
  });
  console.log("\n✓ DB → status=active, charges_enabled=true");
  await p.$disconnect();
} else {
  console.log("\n⚠ Still not active. May need a few more seconds for Stripe to verify.");
}
