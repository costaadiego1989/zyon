/**
 * Self-contained webhook E2E test.
 * Registers a test merchant, creates webhook, tests delivery.
 *
 * Run: cd apps/api && npx tsx scripts/test-webhook-delivery.ts
 * Requires: API on :3009, WEBHOOK_DISPATCHER_ENABLED=true
 */

import http from "node:http";

const API = "http://localhost:3009";
const PORT = 9877;
const EMAIL = `wh-test-${Date.now()}@zyon.dev`;
const PASS = "WebhookTest123!";

const received: string[] = [];
let sessionCookie = "";

function post(path: string, body: object, cookie?: string): Promise<{ status: number; data: any; cookie?: string }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const idempotencyKey = `idk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const req = http.request(`${API}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload).toString(),
        "Idempotency-Key": idempotencyKey,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => raw += c);
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
        try { resolve({ status: res.statusCode!, data: JSON.parse(raw), cookie: setCookie }); }
        catch { resolve({ status: res.statusCode!, data: raw, cookie: setCookie }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function get(path: string, cookie: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${API}${path}`, { method: "GET", headers: { Cookie: cookie } }, (res) => {
      let raw = "";
      res.on("data", (c) => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode!, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode!, data: raw }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function run() {
  console.log("🧪 WEBHOOK E2E — SELF-CONTAINED TEST\n");

  // 1. Start listener
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      received.push(body);
      console.log(`  📨 Webhook received! (#${received.length})`);
      res.writeHead(200);
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(PORT, () => r()));
  console.log(`✅ Listener on :${PORT}\n`);

  try {
    // 2. Register merchant
    console.log("1️⃣  Register merchant...");
    const reg = await post("/auth/register", { email: EMAIL, password: PASS, merchant_name: "WH Test Store" });
    if (reg.status === 201 || reg.status === 200) {
      sessionCookie = reg.cookie ?? "";
      console.log(`   ✅ Registered: ${reg.data.merchantId}`);
    } else if (reg.status === 409) {
      // Already exists, login
      console.log("   ⚡ Already exists, logging in...");
      const login = await post("/auth/login", { email: EMAIL, password: PASS });
      if (login.status !== 200 && login.status !== 201) throw new Error(`Login failed: ${login.status}`);
      sessionCookie = login.cookie ?? "";
      console.log(`   ✅ Logged in`);
    } else {
      throw new Error(`Register failed: ${reg.status} ${JSON.stringify(reg.data)}`);
    }

    if (!sessionCookie) throw new Error("No session cookie received");

    // 3. Create webhook (ALL events to ensure test works)
    console.log("\n2️⃣  Register webhook...");
    const allEvents = [
      "checkout.started", "checkout.abandoned", "order.created", "order.approved",
      "order.cancelled", "payment.pending", "payment.approved", "payment.failed",
      "payment.refunded", "customer.upserted", "tracking.updated",
      "support.ticket.created", "commerce.connection.degraded"
    ];
    const wh = await post("/integrations/webhooks", {
      url: `http://localhost:${PORT}/hook`,
      events: allEvents,
      enabled: true,
    }, sessionCookie);

    let webhookId: string;
    if (wh.status === 201 || wh.status === 200) {
      webhookId = wh.data.id;
      console.log(`   ✅ Webhook: ${webhookId}`);
      if (wh.data.signingSecret) console.log(`   🔐 Secret: ${wh.data.signingSecret.substring(0, 20)}...`);
    } else {
      throw new Error(`Create webhook failed: ${wh.status} ${JSON.stringify(wh.data)}`);
    }

    // 4. Test delivery
    console.log("\n3️⃣  Send test delivery...");
    const test = await post(`/integrations/webhooks/${webhookId}/test`, {}, sessionCookie);
    if (test.status !== 200 && test.status !== 201) {
      console.log(`   ⚠️  Test response: ${test.status}`, test.data);
    } else {
      console.log(`   ✅ Delivery queued: ${test.data.id ?? "ok"}`);
    }

    // 5. Wait for delivery
    console.log("\n4️⃣  Waiting for webhook (max 20s)...");
    const start = Date.now();
    while (received.length === 0 && Date.now() - start < 20_000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    // 6. Result
    console.log("\n════════════════════════════════════════");
    if (received.length > 0) {
      console.log("✅ PASS — Webhook delivery working!");
      try {
        const payload = JSON.parse(received[0]);
        console.log(`   Event: ${payload.event ?? payload.type}`);
        console.log(`   Merchant: ${payload.merchant_id ?? payload.merchantId}`);
      } catch {
        console.log(`   Raw: ${received[0].substring(0, 100)}`);
      }
    } else {
      console.log("❌ FAIL — No delivery received in 20s");

      // Check delivery status
      const dels = await get("/integrations/webhook-deliveries", sessionCookie);
      if (dels.status === 200 && Array.isArray(dels.data)) {
        const recent = dels.data[0];
        if (recent) console.log(`   Last delivery: status=${recent.status}, attempts=${recent.attempts}`);
      }
      console.log("   Troubleshoot:");
      console.log("   - Is WEBHOOK_DISPATCHER_ENABLED=true in .env?");
      console.log("   - Dispatcher interval is 10s — may need more time");
      console.log("   - API must be able to reach localhost:" + PORT);
    }
  } catch (err) {
    console.error("\n❌ ERROR:", (err as Error).message);
  } finally {
    server.close();
    process.exit(received.length > 0 ? 0 : 1);
  }
}

run();
