import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5189";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Local controlled dashboard only");
const out = process.env.REVENUE_UI_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const stamp = new Date().toISOString(), expires = new Date(Date.now() + 7 * 86400000).toISOString();
const proposalHash = "a".repeat(64), recommendationHash = "d".repeat(64);
const recommendation = () => ({ definition: "weekly-incentive-recommendation-v4", selectedCandidateKey: "progressive",
  approval: "separate_incentive_review_required", execution: "unavailable", budgetStatus: "not_reserved", status: "recommended",
  financialPolicy: { version: 1, policyHash: "b".repeat(64), enabled: true, limitCents: 936000, maxDiscountCents: 1000, maxRedemptions: 936 },
  policyProposal: { definition: "incentive-policy-proposal-v1", previousPolicyVersion: 0, previousPolicyHash: "c".repeat(64), basis: "observed_safe_offer_and_required_sample" },
  test: { kind: "capped_progressive_discount", currency: "BRL", discountPercent: 10, maxDiscountCents: 1000, limitCents: 936000,
    maxRedemptions: 936, maxPerBuyer: 1, durationDays: 7, start: "after_specific_approval", allocation: "50/50",
    control: "current_checkout_without_test_incentive", stacking: "no_other_coupon_or_incentive", minimumMarginPercent: 38,
    delivery: { mode: "automatic" }, stages: [
      { index: 0, trigger: "enrollment", discountPercent: 5, maxDiscountCents: 500 },
      { index: 1, trigger: "checkout_payment_ready", discountPercent: 10, maxDiscountCents: 1000 },
    ], audience: { intent: "price_sensitive", consent: "required", identity: "first_eligible_session_per_buyer", holdout: "excluded", minCartTotalCents: 10000, maxCartTotalCents: 10000 },
    measurement: { result: "not_measured", samplePlanning: "included_in_recommendation", conversionWindowHours: 168 } },
  planning: { definition: "incentive-fixed-horizon-planning-v1", result: "not_measured", status: "estimated_feasible", blockers: [],
    baseline: { buyers: 10000, conversions: 10, complete: true, windowStart: stamp, windowEnd: stamp }, durationDays: 7,
    conversionWindowHours: 168, allocation: "50/50", minimumEffectBps: 100, confidence: .95, planningPower: .8,
    minimumBuyersPerArm: 936, weeklyBuyersPerArm: 1250, fundedTreatmentBuyers: 936, requiredBudgetCents: 936000 },
});
function initialReview() {
  return { id: "strategy-ready", merchantId: "merchant-fixture", currentVersion: 1, status: "pending_review", expired: false,
    approval_available: false, activation_available: false, revision_available: true, decision_available: true, activation_blockers: [],
    incentive_alternative_available: false, measurement_status: "included_in_proposal", measurement_warnings: [], actions: [], versions: [{
      version: 1, proposalHash, createdAt: stamp, expiresAt: expires, incentivePolicyCurrent: true,
      proposal: { definition: "checkout-strategy-review-v1", execution: "unavailable", expectedLiftStatus: "not_estimated",
        baselineStatus: "primary_chat_contract_captured", incentiveRecommendation: recommendation(),
        orchestration: { definition: "revenue-strategy-orchestration-v1", tool: "submit_revenue_strategy", selectedAction: recommendationHash,
          catalogHash: "e".repeat(64), rationale: "Avaliar se duas etapas ajudam compradores sensíveis ao preço, mantendo a margem da loja." },
        recommendation: { hypothesis_text: "Testar desconto progressivo durante a compra", reasoning: "O histórico permite testar a oferta com limites definidos.",
          expected_lift_percent: 0, template: { description: "Descrição de comunicação que não deve virar outro teste simultâneo.",
            variant_a: { name: "Atual", system_prompt: "Atual", weight: 50, is_control: true }, variant_b: { name: "Alternativa", system_prompt: "Comunicação alternativa", weight: 50, is_control: false } } },
        rules: { maxDiscountPercent: 10, minimumMarginPercent: 38, allowFreeShipping: false, maxShippingSubsidy: 0 },
        observation: { observation_window_start: stamp, observation_window_end: stamp, funnel: { total_sessions: 10000, conversion_rate: .001 } },
      },
    }] };
}
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultNavigationTimeout(120000); page.setDefaultTimeout(20000);
    const errors = [], mutations = [];
    let review = initialReview(), decision = null, mismatch = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (url.origin === base && !path.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(req.resourceType())) return route.abort();
      let body = {}, status = 200;
      if (path.endsWith("/merchants/me")) body = { id: "merchant-fixture", name: "Loja", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/merchants/me/stores")) body = { data: [{ id: "merchant-fixture", name: "Loja", slug: "fixture" }] };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true }, currentPeriodEnd: "2099-01-01T00:00:00Z" };
      else if (path.endsWith("/notifications")) body = { items: [] };
      else if (path.endsWith("/hypotheses")) body = [{ id: review.id, hypothesis_text: "Testar desconto progressivo durante a compra",
        reasoning: "Oferta sugerida com limites para aprovação.", status: "pending_review", risk_level: "low", expected_lift_percent: 0,
        created_at: stamp, strategy_review: { version: 1, status: "pending_review", title: "Testar desconto progressivo durante a compra",
          expires_at: expires, expected_lift_percent: 0, expected_lift_status: "not_estimated" } }];
      else if (path.endsWith("/rules")) body = { autonomousEngineEnabled: true };
      else if (path.endsWith("/incentive-policy")) body = { merchantId: "merchant-fixture", version: 0, mode: "automatic", policyHash: "c".repeat(64), enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 };
      else if (path.endsWith("/analysis-status")) body = { mode: "weekly", enabled: true, queue_available: true, next_eligible_at: expires, last_successful_at: stamp, overdue: false, run: null };
      else if (["/observations", "/strategy-lessons"].some(p => path.endsWith(p))) body = [];
      else if (path.endsWith("/strategies/strategy-ready")) body = review;
      else if (path.endsWith("/incentive/metrics")) body = { strategyId: review.id, version: 1, proposalHash, execution: null, measurement: null };
      else if (path.endsWith("/incentive")) body = { strategy_id: review.id, version: 1, proposal_hash: proposalHash,
        recommendation_hash: mismatch ? "f".repeat(64) : recommendationHash, status: decision?.status ?? "awaiting_review", decision,
        history: decision ? [decision] : [], approval_available: !decision, rejection_available: !decision,
        withdrawal_available: !!decision, approval_blockers: [], activation_available: !decision,
        execution_status: decision?.kind === "approve" ? "active" : "unavailable", budget: null };
      else if (path.endsWith("/incentive/approve")) {
        const input = req.postDataJSON(); mutations.push({ path, input });
        assert.deepEqual(Object.keys(input).sort(), ["proposal_hash", "recommendation_hash", "request_key", "version"]);
        assert.equal(input.recommendation_hash, recommendationHash);
        decision = { review_id: "review-1", strategy_id: review.id, version: 1, proposal_hash: proposalHash, recommendation_hash: recommendationHash,
          kind: "approve", status: "approved_awaiting_activation", scope: "incentive_recommendation_only", effect: "decision_recorded", reviewed_at: stamp, approval_expires_at: expires };
        body = decision;
      } else if (path.endsWith("/revisions")) {
        const input = req.postDataJSON(); mutations.push({ path, input });
        assert.deepEqual(Object.keys(input).sort(), ["proposal_hash", "request_key", "version"]);
        assert.equal(input.proposal_hash, proposalHash);
        body = { action_id: "alternative-1", strategy_id: review.id, version: 1, proposal_hash: proposalHash, status: "revision_requested" };
        status = 202; review.status = "revision_pending"; review.revision_available = false;
      } else if (req.method() !== "GET") throw new Error(`Unexpected mutation ${path}`);
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/#revenue-manager`, { waitUntil: "domcontentloaded" });
    const summary = page.locator(".revenue-manager-proposal").filter({ hasText: "Testar desconto progressivo durante a compra" });
    await summary.getByText("A medir", { exact: true }).waitFor();
    assert.equal(await summary.getByText("Impacto estimado", { exact: true }).count(), 0);
    assert.equal(await summary.getByText("0,0%", { exact: true }).count(), 0);
    await summary.getByRole("button", { name: "Revisar sugestão", exact: true }).click();
    const section = page.getByRole("region", { name: "Teste de desconto progressivo sugerido", exact: true });
    await section.getByRole("table", { name: "Etapas propostas para o desconto", exact: true }).waitFor();
    await section.getByText(/A segunda etapa substitui a primeira/).waitFor();
    await section.getByText(/Você não precisa preencher os valores/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Aprovar estratégia", exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Comparação com a comunicação atual", exact: true }).count(), 0);
    assert.equal(await page.getByText(/Impacto estimado pela IA:/).count(), 0);
    await page.getByText(/O resultado será medido no teste/).waitFor();
    const approve = section.getByRole("button", { name: "Aprovar e iniciar teste de desconto progressivo", exact: true });
    await approve.click();
    await section.getByText(/Você autoriza até R\$\s*9.360,00 em descontos, no máximo R\$\s*10,00 por pedido e 936 usos/).waitFor();
    assert.equal(mutations.length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (out) { await page.setViewportSize({ width, height: 2600 }); await section.screenshot({ path: `${out}/orchestrated-progressive-${width}.png` }); await page.setViewportSize({ width, height: 1000 }); }
    await section.getByRole("button", { name: "Confirmar início do teste de desconto progressivo", exact: true }).click();
    await section.getByText("Teste de desconto progressivo em andamento.", { exact: true }).waitFor();
    await page.locator(".strategy-version-bar").getByText("Em teste", { exact: true }).waitFor();
    assert.equal(mutations.length, 1);
    decision = { ...decision, kind: "reject", status: "rejected" };
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".strategy-version-bar").getByText("Recusada", { exact: true }).waitFor();
    decision = null; review = initialReview(); await page.reload({ waitUntil: "domcontentloaded" });
    await section.getByRole("button", { name: "Pedir outra estratégia", exact: true }).click();
    await section.getByRole("button", { name: "Solicitar nova sugestão", exact: true }).click();
    await section.getByText(/A IA avaliará outra estratégia/).waitFor();
    await page.locator(".strategy-version-bar").getByText("Preparando alternativa", { exact: true }).waitFor();
    assert.equal(mutations.length, 2); assert.ok(mutations[1].path.endsWith("/revisions"));
    assert.equal(mutations.some(m => m.path.includes("/incentive/alternatives")), false);
    review = initialReview(); mismatch = true; await page.reload({ waitUntil: "domcontentloaded" });
    await section.getByText(/Não foi possível conferir a decisão/).waitFor();
    await page.locator(".strategy-version-bar").getByText("Decisão indisponível", { exact: true }).waitFor();
    assert.equal(await approve.count(), 0);
    mismatch = false; review.versions[0].proposal.orchestration.definition = "future-format";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Atualize o dashboard para consultar e revisar este formato/).waitFor();
    assert.equal(await page.getByRole("button", { name: /Aprovar/ }).count(), 0);
    assert.equal(mutations.length, 2); assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: ready automatic exposure, exact progressive stages, one approval flow, no gain forecast, optional general revision, hash mismatch and unknown-format protection (controlled API)`);
    await page.close();
  }
} finally { await browser.close(); }
