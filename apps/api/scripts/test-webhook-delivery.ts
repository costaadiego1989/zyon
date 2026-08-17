/**
 * Webhook delivery E2E test.
 *
 * Tests: start listener → register webhook → test delivery → verify receipt.
 *
 * Usage:
 *   # Get your session cookie from browser DevTools (Application > Cookies > "session")
 *   AUTH_COOKIE="session=eyJ..." npx tsx scripts/test-webhook-delivery.ts
 *
 *   # Or use existing API key (full secret, not prefix)
 *   API_KEY="aacp_live_xxxxx..." npx tsx scripts/test-webhook-delivery.ts
 *
 * Prerequisites: API running on localhost:3009
 */

import http from "node:http";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3009";
const LISTENER_PORT = 9876;
const AUTH_COOKIE = process.env.AUTH_COOKIE ?? "";
const API_KEY = process.env.API_KEY ?? "";

const receivedDeliveries: Array<{ headers: Record<string, string>; body: string }> = [];

function startListener(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        receivedDeliveries.push({ headers: req.headers as Record<string, string>, body });
        console.log(`  📨 Received webhook #${receivedDeliveries.length}`);
        try {
          const parsed = JSON.parse(body);
          console.log(`     event: ${parsed.event ?? parsed.type}`);
          console.log(`     merchant: ${parsed.merchant_id}`);
        } catch { console.log(`     body: ${body.substring(0, 100)}`); }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });
    });
    server.listen(LISTENER_PORT, () => {
      console.log(`✅ Listener on http://localhost:${LISTENER_PORT}\n`);
      resolve(server);
    });
  });
}

function authHeaders(): Record<string, string> {
  if (API_KEY) return { Authorization: `Bearer ${API_KEY}` };
  if (AUTH_COOKIE) return { Cookie: AUTH_COOKIE };
  throw new Error("Set AUTH_COOKIE or API_KEY env var");
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function run() {
  console.log("🧪 WEBHOOK E2E TEST\n");
  const server = await startListener();

  try {
    // 1. Register webhook
    console.log("1️⃣  Registering webhook...");
    const wh = await api<{ id: string; signingSecret?: string }>("POST", "/integrations/webhooks", {
      url: `http://localhost:${LISTENER_PORT}/webhook`,
      events: ["order.created", "payment.approved", "checkout.started"],
      enabled: true,
    });
    console.log(`   ✅ Webhook: ${wh.id}`);
    if (wh.signingSecret) console.log(`   🔐 Secret: ${wh.signingSecret.substring(0, 20)}...`);

    // 2. Send test delivery
    console.log("\n2️⃣  Sending test delivery...");
    const delivery = await api<{ id: string; status: string }>("POST", `/integrations/webhooks/${wh.id}/test`, {});
    console.log(`   ✅ Delivery queued: ${delivery.id} (${delivery.status})`);

    // 3. Wait for delivery
    console.log("\n3️⃣  Waiting for delivery (max 15s)...");
    const start = Date.now();
    while (receivedDeliveries.length === 0 && Date.now() - start < 15_000) {
      await new Promise((r) => setTimeout(r, 500));
      process.stdout.write(".");
    }
    console.log("");

    // 4. Result
    console.log("\n════════════════════════════════════════");
    if (receivedDeliveries.length > 0) {
      console.log("✅ PASS — Webhook delivered successfully!");
      console.log(`   Signature header: ${receivedDeliveries[0].headers["x-webhook-signature"] ? "present" : "missing"}`);
    } else {
      console.log("❌ FAIL — No delivery received");
      console.log("   Check: WEBHOOK_DISPATCHER_ENABLED=true in apps/api/.env");

      // Check delivery status
      const deliveries = await api<any[]>("GET", "/integrations/webhook-deliveries");
      const found = deliveries.find((d: any) => d.id === delivery.id);
      if (found) console.log(`   Delivery status: ${found.status}, attempts: ${found.attempts}`);
    }
  } catch (err) {
    console.error("\n❌ ERROR:", (err as Error).message);
  } finally {
    server.close();
    process.exit(receivedDeliveries.length > 0 ? 0 : 1);
  }
}

run();
