/**
 * Test the voice/free-text chat flow end-to-end: verifies the LLM navigation
 * tools emit UI blocks (address_confirmation, shipping_options, payment_methods)
 * instead of text-only responses.
 *
 * Run: cd apps/api && npx tsx scripts/test-voice-chat-flow.ts
 * Requires: API on localhost:3009, postgres + redis up.
 */

import http from "node:http";

const API = "http://localhost:3009";
const EMAIL = "costaadiego1989@gmail.com";
const PASS = "ueuf3900";

function req(
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any; cookie?: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body).toString() } : {}),
        "Idempotency-Key": `idk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        ...headers,
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
        try { resolve({ status: res.statusCode!, data: JSON.parse(data), cookie: setCookie }); }
        catch { resolve({ status: res.statusCode!, data, cookie: setCookie }); }
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

function summarizeBlocks(blocks: any[] | undefined): string {
  if (!blocks || !blocks.length) return "NENHUM BLOCK";
  return blocks.map((b) => b.type).join(", ");
}

async function run() {
  console.log("🎤 VOICE/CHAT FLOW E2E TEST\n");

  // 1. Login
  const login = await req("POST", "/auth/login", JSON.stringify({ email: EMAIL, password: PASS }));
  if (login.status !== 200 && login.status !== 201) {
    console.log(`❌ Login failed: ${login.status}`, JSON.stringify(login.data).slice(0, 120));
    process.exit(1);
  }
  const cookie = login.cookie;
  const accessToken = login.data.access_token;
  const merchantId = login.data.merchant_id ?? login.data.merchant?.id ?? login.data.merchantId ?? login.data.user?.merchantId;
  console.log(`✅ Login OK — merchant ${merchantId}`);

  // 2. Embed token
  const authHeader = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : { Cookie: cookie! };
  const token = await req("POST", "/embed-sessions", JSON.stringify({
    ttl_seconds: 3600,
    allowed_origin: "http://localhost:3001",
    scopes: ["checkout:start", "checkout:track", "checkout:chat", "offers:apply"],
  }), authHeader as any);
  const embedToken = token.data.token ?? token.data.embed_session_token;
  if (!embedToken) {
    console.log(`❌ Token gen failed: ${token.status}`, JSON.stringify(token.data).slice(0, 120));
    process.exit(1);
  }
  const bearer = { Authorization: `Bearer ${embedToken}`, Origin: "http://localhost:3001" };
  console.log(`✅ Embed token OK`);

  // 3. Start session WITH pre-populated buyer (simulates storefront authenticated buyer)
  const start = await req("POST", "/embed/start", JSON.stringify({
    merchant_id: merchantId,
    cart: { items: [{ sku: "TEST-1", name: "Produto Teste", quantity: 1, unit_price: 3990 }] },
    customer_hints: {
      fullName: "Diego Costa",
      email: "costaadiego1989@gmail.com",
      cpf: "12345678900",
      phone: "+5521999999999",
    },
  }), bearer);
  const sessionId = start.data.session_id;
  if (!sessionId) {
    console.log(`❌ Start failed: ${start.status}`, JSON.stringify(start.data).slice(0, 200));
    process.exit(1);
  }
  console.log(`✅ Session ${sessionId}\n`);

  // 4. Chat sequence — the messages that failed / didn't render blocks
  const messages = [
    "Vamos prosseguir",
    "Correto",
    "Quais as formas de pagamento você tem?",
  ];

  for (const msg of messages) {
    const res = await req("POST", "/embed/chat", JSON.stringify({
      session_id: sessionId,
      user_message: msg,
      conversation_id: sessionId,
    }), bearer);

    if (res.status !== 200 && res.status !== 201) {
      console.log(`❌ "${msg}" → HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
      continue;
    }
    console.log(`▶ "${msg}"`);
    console.log(`  stage: ${res.data.stage}`);
    console.log(`  blocks: ${summarizeBlocks(res.data.blocks)}`);
    console.log(`  message: ${String(res.data.message).slice(0, 80)}`);
    console.log("");
  }

  console.log("✅ Flow complete. Blocks above should NOT be 'NENHUM BLOCK' at payment stage.");
}

run().catch((e) => { console.error("❌ Error:", e?.stack || e?.message || e); process.exit(1); });
