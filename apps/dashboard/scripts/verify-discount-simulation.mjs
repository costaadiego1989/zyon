import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5187";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Local dashboard with controlled responses only");
const out = process.env.REVENUE_UI_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(20_000); page.setDefaultNavigationTimeout(120_000);
    const errors = [], decisions = [];
    page.on("pageerror", error => errors.push(error.message));
    const hypothesis = { id: "discount-fixture", hypothesis_text: "Testar desconto de 10% para compradores sensíveis a preço",
      reasoning: "Simulação com preços e custos atuais do catálogo.", expected_lift_percent: 7.5, risk_level: "medium",
      status: "pending_review", created_at: "2026-09-29T06:00:00Z", template: { hypothesis_type: "discount_rule",
        discount_rule_json: { id: "rule", name: "Oferta limitada", enabled: false, priority: 100,
          conditions: [{ field: "cart_total", operator: "gte", value: 100 }, { field: "cart_total", operator: "lte", value: 300 },
            { field: "coupon_applied", operator: "is", value: false }], action: { type: "offer_discount", params: { percent: 10, maxDiscountReais: 30 } } },
        discount_simulation: { definition: "discount-catalog-replay-v1", sampleSize: 30, observedConversionRate: .1,
          minimumProjectedMarginPercent: 46, replayDiscountTotalCents: 60000, paymentFeeAssumptionPercent: 4 },
        variant_a: { name: "Controle", weight: 50 }, variant_b: { name: "Proposta", weight: 50 } } };
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (url.origin === base && !path.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(req.resourceType())) return route.abort();
      if (req.method() !== "GET" && /\/(approve|reject|revisions)$/.test(path)) decisions.push(path);
      let body = {}, status = 200;
      if (path.endsWith("/merchants/me")) body = { id: "merchant-fixture", name: "Loja", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true } };
      else if (path.endsWith("/rules")) body = { autonomousEngineEnabled: true };
      else if (path.endsWith("/notifications")) body = { items: [] };
      else if (path.endsWith("/analysis-status")) body = { mode: "weekly", enabled: true, queue_available: true,
        next_eligible_at: "2026-10-06T06:00:00Z", last_successful_at: "2026-09-29T06:00:00Z", overdue: false, run: null };
      else if (path.endsWith("/hypotheses")) body = [hypothesis];
      else if (path.endsWith("/hypotheses/discount-fixture")) body = hypothesis;
      else if (path.endsWith("/strategies/discount-fixture")) { status = 404; body = { message: "STRATEGY_NOT_FOUND" }; }
      else if (path.endsWith("/observations") || path.endsWith("/strategy-lessons")) body = [];
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/#revenue-manager`, { waitUntil: "domcontentloaded" });
    await page.getByText("Efeito na conversão:", { exact: false }).waitFor();
    assert.equal(await page.getByText(/Estimativa da IA:.*7,5/).count(), 0);
    await page.getByRole("button", { name: "Ver detalhes", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Revisar estratégia" });
    await dialog.getByRole("heading", { name: hypothesis.hypothesis_text, exact: true }).waitFor();
    await dialog.getByText("Ver detalhes da estratégia", { exact: true }).click();
    await dialog.getByRole("heading", { name: "Simulação do desconto", exact: true }).waitFor();
    const content = await dialog.innerText();
    assert.match(content, /30 compradores com janela de sete dias encerrada/);
    assert.match(content, /A medir/); assert.doesNotMatch(content, /7,5%/);
    assert.match(content, /margem estimada.*46%/); assert.match(content, /R\$\s*600,00/);
    assert.match(content, /não é uma previsão de gasto nem um orçamento reservado/);
    assert.match(content, /Cupom aplicado igual a Não/);
    assert.ok(await dialog.getByRole("button", { name: "Iniciar teste A/B", exact: true }).isDisabled());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    if (out) await page.screenshot({ path: `${out}/discount-simulation-${width}.png`, fullPage: true });
    // Old drafts lack replay evidence and must not gain an invented simulation.
    delete hypothesis.template.discount_simulation;
    await page.reload({ waitUntil: "domcontentloaded" });
    await dialog.getByRole("heading", { name: hypothesis.hypothesis_text, exact: true }).waitFor();
    await dialog.getByText("Ver detalhes da estratégia", { exact: true }).click();
    await dialog.getByText("A medir", { exact: true }).waitFor();
    assert.equal(await dialog.getByRole("heading", { name: "Simulação do desconto", exact: true }).count(), 0);
    assert.deepEqual(decisions, []); assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: simulation, historical uncertainty, weekly approval gate, no writes or overflow (controlled API)`);
    await page.close();
  }
} finally { await browser.close(); }
