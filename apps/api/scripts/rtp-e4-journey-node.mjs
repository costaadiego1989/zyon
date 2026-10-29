#!/usr/bin/env node

import fs from "fs";
import path from "path";

// Manual .env load
const envPath = path.join(process.cwd(), "apps/api/.env");
const envContent = fs.readFileSync(envPath, "utf-8");
const envVars = {};
envContent.split("\n").forEach((line) => {
  const [key, ...valueParts] = line.split("=");
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join("=").trim();
  }
});

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const API_BASE = envVars.API_BASE || "http://127.0.0.1:3009";
const DB_URL = envVars.DATABASE_URL;
const TIMESTAMP = Date.now();

console.log("\n=== RTP E4 HARD JOURNEY START ===\n");

// Helper: sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper: simple query parser from psql output
async function queryDB(sql) {
  try {
    const { spawn } = await import("child_process");
    return new Promise((resolve, reject) => {
      const cmd = spawn("psql", [
        `-d${DB_URL}`,
        `-t`,
        `-c${sql}`,
      ]);

      let output = "";
      cmd.stdout.on("data", (data) => {
        output += data.toString();
      });

      cmd.stderr.on("data", (data) => {
        console.error("psql error:", data.toString());
      });

      cmd.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`psql failed with code ${code}`));
        }
      });

      cmd.on("error", reject);
    });
  } catch (e) {
    console.error("Query error:", e.message);
    throw e;
  }
}

async function run() {
  try {
    // STEP 1: Query active product
    console.log("STEP 1: Query active product from DB...");
    const productQuery = `SELECT id, name, price, cost FROM products WHERE merchant_id='${MERCHANT_ID}' LIMIT 1;`;
    const productLine = await queryDB(productQuery);

    if (!productLine) {
      throw new Error(`No products found for merchant ${MERCHANT_ID}`);
    }

    const [productId, productName, price, cost] = productLine.split("|").map((s) => s.trim());
    console.log(`✓ Found product: id=${productId}, name=${productName}, price=${price}, cost=${cost}\n`);

    // STEP 2: Start checkout session
    console.log("STEP 2: Start checkout session via API...");
    const buyerEmail = `rtp-e4-${TIMESTAMP}@test.local`;

    const startResponse = await fetch(`${API_BASE}/checkout/start-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        buyerEmail,
        items: [{ productId, quantity: 1 }],
      }),
    });

    const startData = await startResponse.json();
    const { sessionId, orderTotal } = startData;

    if (!sessionId) {
      throw new Error(`Failed to start checkout: ${JSON.stringify(startData)}`);
    }

    console.log(`✓ Checkout started: sessionId=${sessionId}, orderTotal=${orderTotal}\n`);

    // STEP 3: Complete order
    console.log("STEP 3: Complete order via API...");
    const externalOrderId = `RTP_ORDER_${TIMESTAMP}`;

    const completeResponse = await fetch(`${API_BASE}/checkout/orders/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchantId: MERCHANT_ID,
        sessionId,
        externalOrderId,
        payment: { method: "test", status: "approved" },
      }),
    });

    const completeData = await completeResponse.json();
    const { id: orderId, status: orderStatus } = completeData;

    if (!orderId) {
      throw new Error(`Failed to complete order: ${JSON.stringify(completeData)}`);
    }

    console.log(`✓ Order completed: id=${orderId}, status=${orderStatus}\n`);

    // STEP 4: Verify order persisted
    console.log("STEP 4: Verify order in DB...");
    const dbQuery = `SELECT order_total, status FROM completed_orders WHERE id='${orderId}';`;
    const dbLine = await queryDB(dbQuery);

    if (!dbLine) {
      throw new Error(`Order ${orderId} not found in DB`);
    }

    const [dbTotal, dbStatus] = dbLine.split("|").map((s) => s.trim());
    console.log(`✓ Order persisted: total=${dbTotal}, status=${dbStatus}\n`);

    // STEP 5: Verify metrics
    console.log("STEP 5: Verify metrics updated...");
    const countQuery = `SELECT COUNT(*) FROM completed_orders WHERE merchant_id='${MERCHANT_ID}';`;
    const revenueQuery = `SELECT SUM(order_total)::numeric FROM completed_orders WHERE merchant_id='${MERCHANT_ID}';`;

    const countLine = await queryDB(countQuery);
    const revenueLine = await queryDB(revenueQuery);

    const ordersCount = countLine.trim();
    const totalRevenue = revenueLine.trim();

    console.log(`✓ Metrics: orders_count=${ordersCount}, total_revenue=${totalRevenue}\n`);

    // FINAL REPORT
    console.log("=== RTP E4 HARD JOURNEY COMPLETE ===\n");
    console.log("SUMMARY:");
    console.log(`  Seed product:     id=${productId}, price=${price}, cost=${cost}`);
    console.log(`  Order created:    id=${orderId}, total=${dbTotal}, status=${dbStatus}`);
    console.log(`  Metrics:          orders_count=${ordersCount}, total_revenue=${totalRevenue}\n`);
  } catch (error) {
    console.error("\n✗ ERROR:", error.message);
    process.exit(1);
  }
}

run();
