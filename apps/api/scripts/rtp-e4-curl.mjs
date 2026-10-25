#!/usr/bin/env node
/**
 * RTP E4 Hard Journey - Uses curl to work around Node import issues
 */

import { execSync } from "child_process";

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const API_BASE = "http://127.0.0.1:3009";
const TIMESTAMP = Date.now();

console.log("\n=== RTP E4 Hard Journey (via curl) ===\n");

function curl(method, path, data = null) {
  const url = `${API_BASE}${path}`;
  const cmd =
    method === "GET"
      ? `curl -s -X GET "${url}"`
      : data
        ? `curl -s -X ${method} "${url}" -H "Content-Type: application/json" -d '${JSON.stringify(data)}'`
        : `curl -s -X ${method} "${url}"`;

  try {
    const result = execSync(cmd, { encoding: "utf-8" });
    return JSON.parse(result);
  } catch (e) {
    console.error(`curl failed: ${cmd}`);
    throw e;
  }
}

try {
  // STEP 1: Test API is up
  console.log("1. Checking API health...");
  const health = curl("GET", "/health");
  if (health.status !== "ok") {
    throw new Error("API not healthy");
  }
  console.log("✓ API is healthy\n");

  // STEP 2: Start checkout with generic product
  console.log("2. Starting checkout session...");
  const buyerEmail = `rtp-e4-${TIMESTAMP}@test.local`;

  // Try a product that might exist - use a generic SKU
  const productId = "sku_generic_001";

  const startData = curl("POST", "/checkout/start-checkout", {
    merchantId: MERCHANT_ID,
    buyerEmail,
    items: [{ productId, quantity: 1 }],
  });

  if (startData.sessionId) {
    console.log(`✓ Session started: ${startData.sessionId}\n`);

    // STEP 3: Complete order
    console.log("3. Completing order...");
    const externalOrderId = `RTP_ORDER_${TIMESTAMP}`;

    const completeData = curl("POST", "/checkout/orders/complete", {
      merchantId: MERCHANT_ID,
      sessionId: startData.sessionId,
      externalOrderId,
      payment: { method: "test", status: "approved" },
    });

    if (completeData.id) {
      console.log(`✓ Order completed: ${completeData.id}\n`);

      // STEP 4: Report
      console.log("=== SUCCESS ===\n");
      console.log(`Merchant:       ${MERCHANT_ID}`);
      console.log(`Session:        ${startData.sessionId}`);
      console.log(`Order:          ${completeData.id}`);
      console.log(`Total:          ${startData.orderTotal}`);
      console.log(`Status:         ${completeData.status}\n`);

      console.log("✓ E4 DETERMINISTIC JOURNEY COMPLETE\n");
      process.exit(0);
    } else {
      throw new Error(`No orderId: ${JSON.stringify(completeData)}`);
    }
  } else {
    console.error("\n❌ Start checkout failed (likely product not found)");
    console.error(`Response: ${JSON.stringify(startData).slice(0, 500)}\n`);
    console.error("Next step: seed a product for merchant, then re-run\n");
    process.exit(1);
  }
} catch (error) {
  console.error("\n✗ ERROR:", error.message);
  process.exit(1);
}
