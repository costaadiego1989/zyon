/**
 * QA E2E — real merchant, real user, live API. No dev-pass, no mocks.
 * Flow: embed token -> start -> quote shipping -> select -> pay (pix/card/crypto)
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

import { createHmac } from "node:crypto";

const API = process.env.QA_API_BASE ?? "http://localhost:3009";
const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const DEST_ZIP = "25958180";
const GLOBAL_USER_ID = "costaadiego1989@gmail.com";
const ORIGIN = process.env.QA_ORIGIN ?? "http://localhost:3001";

const EMBED_SECRET =
  process.env.EMBED_TOKEN_SECRET ?? "dev_embed_token_secret_32_characters_min!!";

function signEmbedToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    typ: "aacp_embed_v1",
    merchantId: MERCHANT_ID,
    environment: "test",
    issuedAtUnix: now,
    expiresAtUnix: now + 3600,
    nonce: Math.random().toString(36).slice(2),
    allowedOrigin: ORIGIN,
    scopes: [
      "checkout:start",
      "checkout:track",
      "checkout:chat",
      "offers:apply",
      "coupons:apply",
      "payment:intents:create",
      "payment:intents:confirm",
      "payment:intents:read",
    ],
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = createHmac("sha256", Buffer.from(EMBED_SECRET, "utf8"))
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

const TOKEN = signEmbedToken();

async function call(path: string, method: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      Origin: ORIGIN,
      "x-forwarded-for": "189.6.42.10",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

function log(label: string, r: { status: number; json: any }) {
  const ok = r.status >= 200 && r.status < 300;
  console.log(`\n${ok ? "✓" : "✗"} [${r.status}] ${label}`);
  console.log(JSON.stringify(r.json, null, 2).slice(0, 1200));
}

const cart = {
  currency: "BRL" as const,
  total: 129.9,
  source: "checkout" as const,
  items: [
    {
      sku: "relogio-digital-minimal",
      name: "Relógio Digital Minimal",
      price: 129.9,
      quantity: 1,
      weight_kg: 0.5,
      height_cm: 10,
      width_cm: 15,
      length_cm: 20,
    },
  ],
};

async function loginAndFixAsaasConnection() {
  // Log in as the real merchant, then re-save the Asaas connection so the stored
  // secret cipher is re-encrypted with the CURRENT process key (the previously
  // stored cipher was encrypted under a lost key and fails to decrypt at runtime,
  // which is the root cause of the PIX 502). This uses the production endpoint,
  // not a direct DB write.
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "costaadiego1989@gmail.com", password: "ueuf3900" }),
  });
  const loginText = await login.text();
  console.log(`\n[login] status=${login.status}`);
  let jwt: string | undefined;
  try {
    const parsed = JSON.parse(loginText);
    jwt = parsed.access_token ?? parsed.token;
  } catch {}
  if (!jwt) { console.error("LOGIN FAILED — no token in:", loginText.slice(0, 300)); return; }
  console.log("[login] token acquired, len:", jwt.length);

  const asaasKey = process.env.ASAAS_API_KEY_SANDBOX;
  if (!asaasKey) { console.error("ASAAS_API_KEY_SANDBOX not in env"); return; }

  const save = await fetch(`${API}/merchants/me/payment-connections/asaas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "Idempotency-Key": `fix-asaas-cipher-${Date.now()}`,
    },
    body: JSON.stringify({ api_key: asaasKey, sandbox: true }),
  });
  const saveText = await save.text();
  console.log(`[asaas-connection] status=${save.status}`, saveText.slice(0, 300));
}

async function main() {
  console.log("=== QA E2E CHECKOUT — Athom Technologies ===");
  console.log("API:", API, "| Merchant:", MERCHANT_ID, "| Dest CEP:", DEST_ZIP);

  // 0. LOGIN + re-save Asaas connection (fix decryptable cipher)
  await loginAndFixAsaasConnection();

  // 1. START
  const start = await call("/embed/start", "POST", {
    cart,
    cart_ref: `qa-${Date.now()}`,
    global_user_id: GLOBAL_USER_ID,
    customer: {
      email: GLOBAL_USER_ID,
      fullName: "Diego Costa",
      cpf: "05178178700",
      phone: "21993001883",
      address: { zip: DEST_ZIP },
    },
  });
  log("START", start);
  const sessionId = start.json?.session_id ?? start.json?.sessionId;
  if (!sessionId) { console.error("NO SESSION ID — abort"); process.exit(1); }
  console.log("session_id:", sessionId);

  // 2. QUOTE SHIPPING
  const quote = await call("/embed/shipping/quote", "POST", {
    session_id: sessionId,
    destination_zip: DEST_ZIP,
    cart_total: cart.total,
  });
  log("SHIPPING QUOTE", quote);
  const options = quote.json?.options ?? quote.json?.results ?? [];
  if (!Array.isArray(options) || options.length === 0) {
    console.error("!!! NO SHIPPING OPTIONS — this is the bug. Full response above.");
  } else {
    console.log(`Shipping options: ${options.length}`);
    for (const o of options) console.log(`  - ${o.carrier_key ?? o.carrierKey}: ${o.label} R$${((o.price ?? o.customerPrice ?? 0) / 100).toFixed(2)}`);
  }

  // 3. SELECT SHIPPING (first option)
  const firstKey = options[0]?.carrier_key ?? options[0]?.carrierKey;
  if (firstKey) {
    const select = await call("/embed/shipping/select", "POST", {
      session_id: sessionId,
      carrier_key: firstKey,
    });
    log(`SELECT SHIPPING (${firstKey})`, select);
  }

  // 4. PAYMENT INTENTS — pix, then card, then crypto
  for (const method of ["pix", "card", "crypto"] as const) {
    const body: any = {
      session_id: sessionId,
      idempotency_key: `qa-${method}-${Date.now()}`,
      method,
    };
    if (method === "card") {
      body.credit_card = {
        holderName: "Diego Costa",
        number: "5162306219378829", // Asaas sandbox test card
        expiryMonth: "05",
        expiryYear: "2028",
        ccv: "318",
      };
    }
    const intent = await call("/embed/payment/intents", "POST", body);
    log(`PAYMENT INTENT [${method}]`, intent);
  }

  console.log("\n=== DONE ===");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
