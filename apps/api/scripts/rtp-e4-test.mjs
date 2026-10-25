#!/usr/bin/env node
/**
 * RTP E4 Hard Journey - Deterministic Checkout & Verification
 *
 * Workflow:
 * 1. Start checkout session deterministically
 * 2. Complete order with test payment
 * 3. Verify order persisted and queryable
 * 4. Report metrics
 */

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const API_BASE = process.env.API_BASE || "http://127.0.0.1:3009";
const TIMESTAMP = Date.now();

console.log("\n=== RTP E4 Hard Journey - Deterministic Order ===\n");

async function runTest() {
  try {
    // Use a test product that should exist in Athom's catalog
    const productId = "sku_test_001"; // or fetch from DB
    const buyerEmail = `rtp-e4-${TIMESTAMP}@test.local`;
    const externalOrderId = `RTP_ORDER_${TIMESTAMP}`;

    // STEP 1: Start checkout
    console.log("1. Starting checkout session...");
    const startRes = await fetch(`${API_BASE}/checkout/start-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        buyerEmail,
        items: [{ productId, quantity: 1 }],
      }),
    });

    if (!startRes.ok) {
      const errText = await startRes.text();
      throw new Error(
        `start-checkout HTTP ${startRes.status}: ${errText.slice(0, 200)}`
      );
    }

    const startData = await startRes.json();
    const sessionId = startData.sessionId;
    const orderTotal = startData.orderTotal;

    if (!sessionId) {
      throw new Error(`No sessionId in response: ${JSON.stringify(startData)}`);
    }

    console.log(`✓ Session started: ${sessionId} (total: ${orderTotal})\n`);

    // STEP 2: Complete order
    console.log("2. Completing order...");
    const completeRes = await fetch(`${API_BASE}/checkout/orders/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        sessionId,
        externalOrderId,
        payment: { method: "test", status: "approved" },
      }),
    });

    if (!completeRes.ok) {
      const errText = await completeRes.text();
      throw new Error(
        `orders/complete HTTP ${completeRes.status}: ${errText.slice(0, 200)}`
      );
    }

    const completeData = await completeRes.json();
    const orderId = completeData.id;
    const orderStatus = completeData.status;

    if (!orderId) {
      throw new Error(
        `No orderId in response: ${JSON.stringify(completeData)}`
      );
    }

    console.log(`✓ Order completed: ${orderId} (status: ${orderStatus})\n`);

    // STEP 3: Verify order via GET session
    console.log("3. Verifying order in session...");
    const getRes = await fetch(
      `${API_BASE}/checkout/checkout/${MERCHANT_ID}/${sessionId}`
    );

    if (!getRes.ok) {
      throw new Error(
        `GET session HTTP ${getRes.status}`
      );
    }

    const sessionData = await getRes.json();
    console.log(`✓ Session verified: status=${sessionData.status}\n`);

    // STEP 4: Report
    console.log("=== SUMMARY ===\n");
    console.log(`Merchant:       ${MERCHANT_ID}`);
    console.log(`Buyer Email:    ${buyerEmail}`);
    console.log(`Session ID:     ${sessionId}`);
    console.log(`Order ID:       ${orderId}`);
    console.log(`Order Total:    ${orderTotal}`);
    console.log(`Order Status:   ${orderStatus}`);
    console.log(`External ID:    ${externalOrderId}\n`);

    console.log("✓ E4 JOURNEY PASSED\n");
    process.exit(0);
  } catch (error) {
    console.error("✗ ERROR:", error.message);
    console.error("");
    process.exit(1);
  }
}

runTest();
