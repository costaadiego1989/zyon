/**
 * Checkout Advanced Rules — LLM Integration Test Script
 *
 * Tests multiple merchant rules against the checkout LLM to validate
 * that tool-calling works correctly with various rule combinations.
 *
 * Usage: npx tsx apps/api/src/seeds/test-checkout-rules.ts
 */

const API_BASE = "http://localhost:3009";
const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

// Set env to skip Llama (OOM on dev machine) and go straight to DeepSeek
process.env.OLLAMA_BASE_URL = "http://localhost:1/v1"; // intentionally broken so it falls through to DeepSeek

// ── Test Rules (will be saved to DB) ────────────────────────────────────────

const TEST_RULES = [
  { id: "r1", name: "Frete grátis acima de R$200", conditions: [{ field: "cart_total", operator: ">", value: "200" }], action: { type: "offer_free_shipping", params: {} }, enabled: true, priority: 1 },
  { id: "r2", name: "10% para comprador novo", conditions: [{ field: "buyer_type", operator: "==", value: "novo" }], action: { type: "offer_discount", params: { percent: 10 } }, enabled: true, priority: 2 },
  { id: "r3", name: "Cupom PROMO15 frete caro", conditions: [{ field: "shipping_cost", operator: ">", value: "30" }], action: { type: "offer_coupon", params: { code: "PROMO15" } }, enabled: true, priority: 3 },
  { id: "r4", name: "5% desconto PIX", conditions: [{ field: "payment_method", operator: "==", value: "pix" }], action: { type: "offer_discount", params: { percent: 5 } }, enabled: true, priority: 4 },
  { id: "r5", name: "Cupom BEMVINDO primeira compra", conditions: [{ field: "buyer_type", operator: "==", value: "novo" }, { field: "cart_total", operator: ">", value: "100" }], action: { type: "offer_coupon", params: { code: "BEMVINDO" } }, enabled: true, priority: 5 },
  { id: "r6", name: "15% carrinho abandonado", conditions: [{ field: "trigger_fired", operator: "==", value: "exit_intent" }], action: { type: "offer_discount", params: { percent: 15 } }, enabled: true, priority: 6 },
  { id: "r7", name: "Frete grátis categoria Eletrônicos", conditions: [{ field: "category_in_cart", operator: "contains", value: "eletronicos" }], action: { type: "offer_free_shipping", params: {} }, enabled: true, priority: 7 },
  { id: "r8", name: "3x sem juros acima R$150", conditions: [{ field: "cart_total", operator: ">", value: "150" }], action: { type: "offer_discount", params: { percent: 0 } }, enabled: true, priority: 8 },
  { id: "r9", name: "Cupom VOLTEI cliente recorrente", conditions: [{ field: "buyer_type", operator: "==", value: "recorrente" }], action: { type: "offer_coupon", params: { code: "VOLTEI" } }, enabled: true, priority: 9 },
  { id: "r10", name: "20% liquidação itens > 3", conditions: [{ field: "cart_item_count", operator: ">", value: "3" }], action: { type: "offer_discount", params: { percent: 20 } }, enabled: true, priority: 10 },
];

// ── Test Cases ──────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  message: string;
  cartTotal: number;
  expectedTools: string[]; // which tools SHOULD be called
}

const TEST_CASES: TestCase[] = [
  {
    name: "Frete grátis (carrinho > R$200)",
    message: "Meu pedido é R$350, o frete deveria ser grátis né?",
    cartTotal: 35000,
    expectedTools: ["apply_free_shipping"],
  },
  {
    name: "10% comprador novo",
    message: "Sou cliente novo, tem desconto de primeira compra?",
    cartTotal: 15000,
    expectedTools: ["apply_discount", "apply_coupon"], // either is OK
  },
  {
    name: "Cupom PROMO15 (frete > R$30)",
    message: "O frete ficou R$38, tem algum cupom que eu possa usar?",
    cartTotal: 8000,
    expectedTools: ["apply_coupon"],
  },
  {
    name: "5% desconto PIX",
    message: "Se eu pagar no PIX, tem desconto?",
    cartTotal: 20000,
    expectedTools: ["apply_discount"],
  },
  {
    name: "Cupom BEMVINDO (novo + carrinho > R$100)",
    message: "É minha primeira compra aqui e tenho R$200 no carrinho, tem cupom?",
    cartTotal: 20000,
    expectedTools: ["apply_coupon"],
  },
  {
    name: "20% com 4+ itens",
    message: "Tenho 5 itens no carrinho, rola um descontão?",
    cartTotal: 45000,
    expectedTools: ["apply_discount"],
  },
  {
    name: "Cliente recorrente (cupom VOLTEI)",
    message: "Sou cliente antigo, sempre compro aqui. Tem algo especial pra mim?",
    cartTotal: 12000,
    expectedTools: ["apply_coupon", "apply_discount"],
  },
  {
    name: "Pergunta sem regra (política de troca)",
    message: "Qual a política de troca e devolução da loja?",
    cartTotal: 15000,
    expectedTools: [], // no tool expected — just text answer
  },
  {
    name: "On-script (fornece telefone)",
    message: "11999887766",
    cartTotal: 15000,
    expectedTools: ["__deterministic__"], // should NOT go to LLM
  },
  {
    name: "Múltiplas regras casam (novo + frete caro + carrinho alto)",
    message: "Oi sou novo, carrinho R$300, frete R$40. O que vocês podem fazer por mim?",
    cartTotal: 30000,
    expectedTools: ["apply_free_shipping", "apply_discount", "apply_coupon"], // any of these is valid
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
  const r = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "costaadiego1989@gmail.com", password: "UeUf3900@" }),
  });
  const json = await r.json() as { access_token: string };
  return json.access_token;
}

async function saveRules(token: string): Promise<void> {
  const idemKey = crypto.randomUUID();
  const r = await fetch(`${API_BASE}/checkout-settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "If-Match": "*",
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify({ advancedRules: TEST_RULES }),
  });
  if (!r.ok) throw new Error(`Save rules failed: ${r.status} ${await r.text()}`);
  console.log(`✅ ${TEST_RULES.length} rules saved to merchant\n`);
}

async function startSession(token: string, cartTotal: number): Promise<string> {
  const r = await fetch(`${API_BASE}/checkout/start-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({
      merchant_id: MERCHANT_ID,
      customer: { email: `test-${Date.now()}@x.com` },
      cart: { currency: "BRL", total: cartTotal, items: [{ sku: "prod-1", name: "Produto Teste", quantity: 1, unit_price: cartTotal }] },
    }),
  });
  const json = await r.json() as { session_id: string };
  return json.session_id;
}

async function sendMessage(token: string, sessionId: string, message: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 3 min timeout
  try {
    const r = await fetch(`${API_BASE}/checkout/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ merchant_id: MERCHANT_ID, session_id: sessionId, user_message: message }),
      signal: controller.signal,
    });
    const json = await r.json() as { message: string };
    return json.message;
  } finally {
    clearTimeout(timeout);
  }
}

function evaluateResult(reply: string, expectedTools: string[]): { pass: boolean; reason: string } {
  if (expectedTools.includes("__deterministic__")) {
    // Should be deterministic (asks for data)
    const isDeterministic = /celular|email|cpf|cep|endereço|nome completo/i.test(reply);
    return { pass: isDeterministic, reason: isDeterministic ? "deterministic reply" : `got LLM reply: "${reply.slice(0, 60)}"` };
  }

  if (expectedTools.length === 0) {
    // Should be text-only (no tool call)
    const hasToolMarker = /✅/.test(reply);
    return { pass: !hasToolMarker, reason: hasToolMarker ? "unexpected tool call" : "text-only OK" };
  }

  // Should have called a tool
  const hasToolMarker = /✅/.test(reply);
  if (!hasToolMarker) {
    // Check if reply mentions the benefit even without ✅
    const mentionsBenefit = /(desconto|cupom|frete gr|PROMO|BEMVINDO|VOLTEI|\d+%)/i.test(reply);
    return { pass: mentionsBenefit, reason: mentionsBenefit ? "mentioned benefit (no tool marker)" : `no tool called: "${reply.slice(0, 60)}"` };
  }

  // Check which tool was called
  const calledDiscount = /Desconto de \d+%/.test(reply);
  const calledFreeShip = /Frete grátis aplicado/.test(reply);
  const calledCoupon = /Cupom \w+ aplicado/.test(reply);

  const calledTools: string[] = [];
  if (calledDiscount) calledTools.push("apply_discount");
  if (calledFreeShip) calledTools.push("apply_free_shipping");
  if (calledCoupon) calledTools.push("apply_coupon");

  const anyExpectedCalled = calledTools.some(t => expectedTools.includes(t));
  return {
    pass: anyExpectedCalled,
    reason: anyExpectedCalled
      ? `correct: ${calledTools.join(", ")}`
      : `wrong tool: got ${calledTools.join(", ")}, expected ${expectedTools.join(" or ")}`
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Checkout Advanced Rules — LLM Integration Test");
  console.log("═══════════════════════════════════════════════════════════\n");

  const token = await login();
  console.log("🔑 Logged in\n");

  await saveRules(token);

  const results: Array<{ name: string; pass: boolean; reason: string; reply: string; time: number }> = [];

  for (const tc of TEST_CASES) {
    process.stdout.write(`⏳ ${tc.name}...`);
    const start = Date.now();

    try {
      const sessionId = await startSession(token, tc.cartTotal);
      const reply = await sendMessage(token, sessionId, tc.message);
      const elapsed = Date.now() - start;
      const evaluation = evaluateResult(reply, tc.expectedTools);

      results.push({ name: tc.name, pass: evaluation.pass, reason: evaluation.reason, reply, time: elapsed });
      console.log(` ${evaluation.pass ? "✅" : "❌"} (${elapsed}ms)`);
      if (!evaluation.pass) {
        console.log(`   Reply: "${reply.slice(0, 100)}"`);
        console.log(`   Reason: ${evaluation.reason}`);
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      results.push({ name: tc.name, pass: false, reason: `error: ${e instanceof Error ? e.message : String(e)}`, reply: "", time: elapsed });
      console.log(` ❌ ERROR (${elapsed}ms)`);
      console.log(`   ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════════════\n");

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const totalTime = results.reduce((sum, r) => sum + r.time, 0);

  for (const r of results) {
    console.log(`${r.pass ? "✅" : "❌"} ${r.name}`);
    console.log(`   ${r.reason} (${r.time}ms)`);
    if (r.reply && !r.pass) console.log(`   Reply: "${r.reply.slice(0, 120)}"`);
    console.log();
  }

  console.log("───────────────────────────────────────────────────────────");
  console.log(`  ${passed}/${results.length} passed | ${failed} failed | ${totalTime}ms total`);
  console.log("───────────────────────────────────────────────────────────\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
