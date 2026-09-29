import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5186";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Local mock dashboard only");
const out = process.env.REVENUE_UI_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const stamp = new Date().toISOString();
const expires = new Date(Date.now() + 7 * 86400000).toISOString();
const firstTitle = "Explicar as opções de pagamento com mais clareza";
const secondTitle = "Perguntar qual dúvida impede a conclusão da compra";
function version(n) {
  return { version: n, proposalHash: String(n).repeat(64), createdAt: stamp, expiresAt: expires, incentivePolicyCurrent: true,
    proposal: { definition: "checkout-strategy-review-v1", execution: "unavailable", expectedLiftStatus: "model_estimate_not_measured",
      baselineStatus: "primary_chat_contract_captured",
      checkoutBaseline: { contextExit: "checkout-context-exit-v1", suppressionRecovery: "checkout-suppression-recovery-v1" },
      recommendation: { hypothesis_text: n === 1 ? firstTitle : secondTitle, reasoning: "A análise identificou dificuldades na etapa de pagamento.",
        expected_lift_percent: 2, template: { description: "Explicar as opções verificadas, sem oferecer descontos adicionais.",
          variant_a: { name: "Atual", system_prompt: "checkout-chat-baseline-v1:fixture", weight: 50, is_control: true },
          variant_b: { name: "Comunicação", system_prompt: "Pergunte qual etapa precisa de explicação e use apenas dados verificados.", weight: 50, is_control: false } } },
      rules: { maxDiscountPercent: 10, minimumMarginPercent: 38, allowFreeShipping: false, maxShippingSubsidy: 0 },
      incentiveRecommendation: { definition: "weekly-incentive-recommendation-v2", status: "recommended",
        approval: "separate_incentive_review_required", execution: "unavailable", budgetStatus: "not_reserved",
        financialPolicy: { version: 1, policyHash: "p".repeat(64) },
        planning: { definition: "incentive-fixed-horizon-planning-v1", result: "not_measured", status: "blocked",
          baseline: { buyers: 1000, conversions: 100, complete: true, windowStart: stamp, windowEnd: stamp },
          durationDays: 7, conversionWindowHours: 168, allocation: "50/50", minimumEffectBps: 100, confidence: .95, planningPower: .8,
          minimumBuyersPerArm: 14751, weeklyBuyersPerArm: 125, fundedTreatmentBuyers: 30, requiredBudgetCents: 14751000,
          blockers: ["insufficient_weekly_traffic", "insufficient_budget"] },
        test: { kind: "capped_percentage_discount", currency: "BRL", discountPercent: 10, maxDiscountCents: 1000,
          limitCents: 30000, maxRedemptions: 30, maxPerBuyer: 1, durationDays: 7, start: "after_specific_approval",
          allocation: "50/50", control: "current_checkout_without_test_incentive", stacking: "no_other_coupon_or_incentive",
          minimumMarginPercent: 38, audience: { intent: "price_sensitive", consent: "required",
            identity: "first_eligible_session_per_buyer", holdout: "excluded", minCartTotalCents: 10000, maxCartTotalCents: 20000 },
          measurement: { conversionWindowHours: 168, result: "not_measured", samplePlanning: "included_in_recommendation" } } },
      discountStudy: { definition: "weekly-discount-study-v1", asOf: stamp, capturedAt: stamp, lookbackDays: 28,
        approvalScope: "communication_only", commercialBudget: "not_reserved", status: "candidate_available",
        candidate: { intent: "price_sensitive", percent: 10, simulation: { sampleSize: 30,
          observedConversionRate: .1, minimumProjectedMarginPercent: 46, minCartTotalCents: 10000,
          maxCartTotalCents: 20000, maxDiscountCents: 2000, replayDiscountTotalCents: 60000,
          paymentFeeAssumptionPercent: 4, conversionWindowHours: 168 } } },
      observation: { observation_window_start: stamp, observation_window_end: stamp, funnel: { total_sessions: 1000, conversion_rate: .1 } },
      experimentReview: { definition: "checkout-strategy-experiment-review-v1", registration: "proposal_only_not_activated", capacity: "below_planned_sample",
        planning: { capturedAt: stamp, population: { definition: "checkout-first-session-per-buyer-v1" } },
        plan: { definitionVersion: "session-conversion-fixed-horizon-v1", durationDays: 7, conversionWindowHours: 24, minimumEffectBps: 100,
          minimumSessionsPerArm: 14800, confidence: .95, planningPower: .8, allocation: "50/50",
          trafficEstimate: { sessionsPerArm: 125, reachesPlannedSample: false },
          baseline: { sessions: 1000, conversions: 100, windowStart: stamp, windowEnd: stamp } } } } };
}
function initialReview() { return { id: "proposal-fixture", merchantId: "merchant-fixture", currentVersion: 1, status: "pending_review",
  versions: [version(1)], actions: [], expired: false, approval_available: false, activation_available: false, revision_available: true,
  activation_blockers: ["versioned_checkout_execution_required", "durable_assignment_and_exposure_required"],
  measurement_status: "included_in_proposal", measurement_warnings: ["planned_sample_capacity_insufficient"] }; }

const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15_000);
    // First navigation may compile the full dashboard in the local Vite fixture.
    page.setDefaultNavigationTimeout(120_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let review = initialReview(), readStatus = 200, failAction = null, hypothesisReads = 0;
    let metricsState = null, metricsFailure = false, paymentCostMode = "covered", participationMode = "current";
    const posts = [], legacyMutations = [], receipts = new Map();
    const incentivePosts = [], incentiveReceipts = new Map();
    let incentiveDecision = null, incentiveEnabled = false, incentiveFail = null, incentiveReadFailed = false;
    let outcome = "recommendations";
    await page.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      if (url.origin === base && !path.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(req.resourceType())) return route.abort();
      let body = {}, status = 200;
      if (path.endsWith("/merchants/me")) body = { id: "merchant-fixture", name: "Loja de teste", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true }, currentPeriodEnd: "2099-01-01T00:00:00Z" };
      else if (path.endsWith("/rules")) body = { autonomousEngineEnabled: true };
      else if (path.endsWith("/notifications")) body = { items: [{ id: "strategy:fixture", type: "ai_strategy_suggestion", title: "Nova versão da estratégia para revisar", createdAt: stamp, metadata: { strategyId: review.id } }] };
      else if (path.endsWith("/analysis-status")) body = { mode: "weekly", enabled: true, queue_available: true, next_eligible_at: expires,
        last_successful_at: stamp, overdue: false, run: { id: "fixture", status: "completed", result: outcome, reason: null,
          createdAt: stamp, completedAt: stamp, hypothesisId: outcome === "recommendations" ? review.id : null } };
      else if (path.endsWith("/hypotheses")) body = outcome === "recommendations" ? [{ id: review.id, hypothesis_text: firstTitle, reasoning: "Histórico", expected_lift_percent: 1,
        risk_level: "low", status: "pending_review", created_at: stamp, template: {}, strategy_review: { version: review.currentVersion,
          status: review.status, title: review.versions[0].proposal.recommendation.hypothesis_text, expected_lift_percent: 2, expires_at: expires } }] : [];
      else if (path.includes("/hypotheses/")) { hypothesisReads++; if (req.method() !== "GET") legacyMutations.push(path); body = { message: "Hypothesis not found" }; status = 404; }
      else if (path.endsWith(`/strategies/${review.id}`)) { status = readStatus; body = status === 200 ? review : { message: status === 404 ? "STRATEGY_NOT_FOUND" : "Forbidden" }; }
      else if (path.includes(`/strategies/${review.id}/incentive`)) {
        const current = review.versions[0], rec = current.proposal.incentiveRecommendation;
        const ready = incentiveEnabled && current.incentivePolicyCurrent !== false && rec?.definition === "weekly-incentive-recommendation-v2" && rec.planning?.status === "estimated_feasible";
        if (req.method() === "GET") {
          if (incentiveReadFailed) { status = 503; body = { message: "Unavailable" }; }
          else body = { strategy_id: review.id, version: current.version, proposal_hash: current.proposalHash, recommendation_hash: "d".repeat(64),
            status: incentiveDecision?.status ?? "awaiting_review", decision: incentiveDecision,
            history: incentiveDecision ? [incentiveDecision] : [], approval_available: ready && !incentiveDecision,
            rejection_available: !incentiveDecision && rec?.status === "recommended", withdrawal_available: incentiveDecision?.kind === "approve",
            approval_blockers: ready ? [] : ["review_disabled"], execution_status: "unavailable", budget: null };
        } else {
          const input = req.postDataJSON(), kind = path.split("/").at(-1);
          incentivePosts.push({ kind, input, key: req.headers()["idempotency-key"] });
          assert.deepEqual(Object.keys(input).sort(), ["proposal_hash", "recommendation_hash", "request_key", "version"]);
          assert.equal(input.proposal_hash, current.proposalHash); assert.equal(input.version, current.version);
          assert.equal(input.recommendation_hash, "d".repeat(64)); assert.equal(req.headers()["idempotency-key"], input.request_key);
          if (incentiveReceipts.has(input.request_key)) body = incentiveReceipts.get(input.request_key);
          else if (incentiveFail === "conflict") { incentiveFail = null; status = 409; body = { code: "INCENTIVE_REVIEW_PREREQUISITES_REQUIRED" }; }
          else {
            assert.ok(["approve", "reject", "withdraw"].includes(kind));
            if (kind === "approve") assert.equal(ready, true);
            incentiveDecision = { review_id: `incentive-${incentivePosts.length}`, strategy_id: review.id, version: current.version,
              proposal_hash: current.proposalHash, recommendation_hash: input.recommendation_hash, kind,
              status: kind === "approve" ? "approved_awaiting_activation" : kind === "reject" ? "rejected" : "withdrawn",
              scope: "incentive_recommendation_only", effect: "decision_recorded", reviewed_at: stamp, approval_expires_at: expires };
            body = incentiveDecision; incentiveReceipts.set(input.request_key, body);
            if (incentiveFail === "unknown") { status = 503; body = { message: "Timeout" }; incentiveFail = null; }
          }
        }
      }
      else if (path.endsWith(`/strategies/${review.id}/metrics`)) {
        const input = req.postDataJSON(); assert.deepEqual(Object.keys(input), ["version"]);
        const metricVersion = input.version;
        if (metricsFailure) { status = 503; body = { message: "Unavailable" }; }
        else {
          const active = metricsState && metricVersion === 1;
          const arm = { assigned: 100, mature: 80, converted: 8, orders: 9, revenueCents: 100000 };
          const delivery = { assigned: 100, mature: 80, pending: 20, sessionsWithPublication: 70, sessionsWithDisplay: 60 };
          body = { strategyId: review.id, version: metricVersion,
            execution: active ? { id: "execution-fixture", proposalHash: "1".repeat(64),
              status: ["positive", "invalid"].includes(metricsState) ? "stopped" : "running", startedAt: stamp, endsAt: expires,
              stoppedAt: metricsState === "positive" ? expires : metricsState === "invalid" ? stamp : null } : null,
            measurement: active ? { collectedAt: stamp, evidenceHash: "e".repeat(64), result: {
              definitionVersion: "session-conversion-fixed-horizon-v1", state: metricsState, reasons: [], asOf: stamp, matureAt: expires,
              control: arm, treatment: { ...arm, converted: 12, orders: 12, revenueCents: 150000 }, minimumSessionsPerArm: 14800,
              interval: metricsState === "positive" ? { effectBps: 500, lowerBps: 100, upperBps: 900 } : null,
              contributionCents: null, aiCostCents: null, promotionAllowed: false,
              participation: participationMode === "absent" ? undefined : { definition: participationMode === "unknown" ? "unknown" : "strategy-participation-v1",
                populationSource: "immutable_strategy_assignments",
                control: { assigned: 100, stoppedSessions: 4, contextExitSessions: 3 },
                treatment: { assigned: 100, stoppedSessions: 6, contextExitSessions: 5 } },
              paymentCosts: paymentCostMode === "absent" ? undefined : { definition: "strategy-payment-cost-coverage-v1", currency: "BRL", scope: "mature_approved_orders",
                source: "latest_recorded_payment_settlement",
                control: { orders: 9, linkedOrders: 9, coveredOrders: 9, confirmedPlatformFeeCents: paymentCostMode === "zero" ? 0 : 1200,
                  confirmedProviderFeeCents: paymentCostMode === "zero" ? 0 : 2800, confirmedPaymentFeesCents: paymentCostMode === "zero" ? 0 : 4000,
                  knownConfirmedPaymentFeesCents: paymentCostMode === "zero" ? 0 : 4000 },
                treatment: { orders: 12, linkedOrders: 12, coveredOrders: 10, confirmedPlatformFeeCents: null,
                  confirmedProviderFeeCents: null, confirmedPaymentFeesCents: null, knownConfirmedPaymentFeesCents: 4500 } },
              aiUsage: { definition: "strategy-chat-ai-usage-v1", scope: "pinned_strategy_chat_calls", tariffBasis: "upper_bound_estimate",
                control: { admittedTurns: 80, pricedTurns: 80, notDispatchedTurns: 0, unknownTurns: 0, currency: "USD", estimatedCostMicros: 13 },
                treatment: { admittedTurns: 90, pricedTurns: 89, notDispatchedTurns: 0, unknownTurns: 1, currency: "USD", estimatedCostMicros: null } },
              economics: { definition: "strategy-order-cost-coverage-v1", source: "catalog_at_order_recording",
                control: { orders: 9, capturedOrders: 9, coveredOrders: 9, configuredProductCostCents: 50000, knownConfiguredProductCostCents: 50000 },
                treatment: { orders: 12, capturedOrders: 12, coveredOrders: 10, configuredProductCostCents: null, knownConfiguredProductCostCents: 60000 } },
              delivery: { definition: "strategy-assignment-delivery-v1", control: delivery, treatment: { ...delivery, sessionsWithDisplay: 62 } },
            } } : null };
        }
      }
      else if (path.includes(`/strategies/${review.id}/`)) {
        const input = req.postDataJSON(); posts.push({ path, input, key: req.headers()["idempotency-key"] });
        if (failAction === "conflict") {
          failAction = null; review.currentVersion = 2; review.versions = [version(2), version(1)];
          status = 409; body = { message: "STRATEGY_VERSION_CONFLICT" };
        } else if (receipts.has(input.request_key)) body = receipts.get(input.request_key);
        else {
          assert.equal(input.version, review.currentVersion);
          assert.equal(input.proposal_hash, review.versions[0].proposalHash);
          const approve = path.endsWith("/approve");
          assert.deepEqual(Object.keys(input).sort(), approve ? ["proposal_hash", "request_key", "version"] : ["feedback", "proposal_hash", "request_key", "version"]);
          const revision = path.endsWith("/revisions");
          body = { action_id: `action-${posts.length}`, strategy_id: review.id, version: input.version, proposal_hash: input.proposal_hash,
            status: approve ? "active" : revision ? "revision_requested" : "rejected",
            ...(approve ? { execution_id: "exec-fixture", experiment_id: "experiment-fixture", started_at: stamp, ends_at: expires } : {}) };
          receipts.set(input.request_key, body);
          review.status = approve ? "active" : revision ? "revision_pending" : "rejected"; review.revision_available = false;
          if (approve) { review.approval_available = false; review.activation_available = false; }
          review.actions.unshift({ id: body.action_id, version: input.version, kind: approve ? "approve" : revision ? "revision" : "reject", feedback: input.feedback,
            createdAt: stamp, revision: revision ? { status: "deferred", reason: "budget_exhausted", completedAt: null } : null });
          status = revision ? 202 : 200;
          if (failAction === "unknown") { status = 503; body = { message: "Gateway timeout" }; failAction = null; }
        }
      } else if (path.endsWith("/observations") || path.endsWith("/strategy-lessons")) body = [];
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const detail = `${base}/#revenue-manager?strategy=proposal-fixture`;
    const open = async () => {
      await page.goto(detail, { waitUntil: "domcontentloaded" });
      try { await page.getByRole("heading", { name: firstTitle, exact: true }).waitFor({ timeout: 30_000 }); }
      catch (error) { console.error("Fixture startup", errors, (await page.locator("body").innerText()).slice(0, 2500)); throw error; }
    };
    const requestAlternative = async () => { await page.getByRole("button", { name: "Pedir alternativa", exact: true }).click(); await page.getByLabel("O que a IA deve considerar na alternativa?").fill("Prefiro explicar sem pressionar o comprador."); };
    const noOverflow = async (size) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `overflow at ${size}`);

    await open();
    assert.equal(await page.getByRole("button", { name: "Aprovar estratégia", exact: true }).isDisabled(), true);
    await page.getByText(/tráfego estimado está abaixo/).waitFor();
    assert.equal(posts.length, 0, "Reading never submits a decision");
    assert.equal(await page.getByText(/checkout-chat-baseline-v1:/).count(), 0);
    const incentive = page.getByRole("region", { name: "Teste de desconto sugerido", exact: true });
    await incentive.getByText(/300,00 para até 30 usos/).waitFor();
    await incentive.getByText(/10%, até R\$\s*10,00 por compra/).waitFor();
    await incentive.getByText("7 dias após aprovação específica", { exact: true }).waitFor();
    await incentive.getByText(/Aprovar a comunicação abaixo não autoriza o desconto/).waitFor();
    await incentive.getByRole("heading", { name: "Condições para medir o teste", exact: true }).waitFor();
    await incentive.getByText(/movimento estimado para sete dias fica abaixo/).waitFor();
    await incentive.getByText(/orçamento e os usos sugeridos não cobrem/).waitFor();
    assert.equal(await incentive.locator("input, select, textarea").count(), 0, "The motor designs financial terms");
    assert.equal(await incentive.getByRole("button", { name: "Aprovar proposta de desconto", exact: true }).count(), 0);
    await incentive.getByText("Regras e métricas do teste sugerido", { exact: true }).click();
    await incentive.getByText(/não uma previsão de demanda/).waitFor();
    await incentive.getByText(/janela de compra de sete dias/).waitFor();
    await noOverflow(width);
    // A taller capture keeps the complete section below the sticky app header.
    // The interaction checks still use the 900px viewport above and below.
    if (out) await page.setViewportSize({ width, height: 1800 });
    if (out) await incentive.screenshot({ path: `${out}/incentive-recommendation-${width}.png` });
    review.versions[0].incentivePolicyCurrent = false;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await incentive.getByText(/Os limites financeiros mudaram após esta análise/).waitFor();
    await incentive.getByText(/300,00 para até 30 usos/).waitFor();
    if (out) await incentive.screenshot({ path: `${out}/incentive-stale-policy-${width}.png` });
    if (out) await page.setViewportSize({ width, height: 900 });
    const savedIncentive = structuredClone(review.versions[0].proposal.incentiveRecommendation);
    const refreshIncentive = async rec => {
      review.versions[0].proposal.incentiveRecommendation = rec;
      await page.reload({ waitUntil: "domcontentloaded" });
    };
    await refreshIncentive({ ...savedIncentive, test: { ...savedIncentive.test, limitCents: 20000000, maxRedemptions: 20000 },
      planning: { ...savedIncentive.planning, status: "estimated_feasible", blockers: [],
        baseline: { ...savedIncentive.planning.baseline, buyers: 10000, conversions: 10 },
        minimumBuyersPerArm: 936, weeklyBuyersPerArm: 1250, fundedTreatmentBuyers: 20000, requiredBudgetCents: 936000 } });
    await incentive.getByText(/histórico e os limites sugeridos comportavam a amostra/).waitFor();
    await incentive.getByText("Como o motor planejou a medição", { exact: true }).click();
    await incentive.getByText(/critério de planejamento, não uma previsão/).waitFor();
    await incentive.getByText(/Quem não comprar não gera gasto/).waitFor();
    await noOverflow(width);
    if (out) await page.setViewportSize({ width, height: 2200 });
    if (out) await incentive.screenshot({ path: `${out}/incentive-planning-feasible-${width}.png` });
    if (out) await page.setViewportSize({ width, height: 900 });
    // The merchant reviews immutable suggested values, never constructs a test.
    assert.equal(incentivePosts.length, 0);
    incentiveEnabled = true; review.versions[0].incentivePolicyCurrent = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    const approveIncentive = incentive.getByRole("button", { name: "Aprovar proposta de desconto", exact: true });
    await approveIncentive.click();
    await incentive.getByText(/Nenhum teste será iniciado agora/).waitFor();
    incentiveFail = "unknown";
    await incentive.getByRole("button", { name: "Registrar aprovação do desconto", exact: true }).click();
    await incentive.getByText(/A confirmação não chegou/).waitFor();
    const retryIncentive = incentive.getByRole("button", { name: "Confirmar decisão do desconto", exact: true });
    await retryIncentive.click();
    await incentive.getByText("Proposta de desconto aprovada. O teste ainda não foi iniciado.", { exact: true }).waitFor();
    await retryIncentive.waitFor({ state: "detached" });
    assert.equal(incentivePosts.length, 2);
    assert.deepEqual(incentivePosts[0], incentivePosts[1], "Lost approval reply must reuse the exact command");
    assert.equal(review.status, "pending_review"); assert.equal(posts.length, 0);
    await noOverflow(width);
    if (out) {
      await page.setViewportSize({ width, height: 2400 });
      await incentive.screenshot({ path: `${out}/incentive-approved-${width}.png` });
      await page.setViewportSize({ width, height: 900 });
    }
    incentiveReadFailed = true;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await incentive.getByText(/Não foi possível conferir a decisão/).waitFor();
    assert.equal(await incentive.getByRole("button", { name: "Cancelar aprovação do desconto", exact: true }).isDisabled(), true);
    incentiveReadFailed = false;
    await incentive.getByRole("button", { name: "Atualizar decisão do desconto", exact: true }).click();
    await incentive.getByRole("button", { name: "Cancelar aprovação do desconto", exact: true }).click();
    await incentive.getByRole("button", { name: "Confirmar cancelamento do desconto", exact: true }).click();
    await incentive.getByText("A aprovação do desconto foi cancelada.", { exact: true }).waitFor();
    assert.equal(incentivePosts.length, 3);
    await page.reload({ waitUntil: "domcontentloaded" });
    await incentive.getByText("A aprovação do desconto foi cancelada.", { exact: true }).waitFor();
    assert.equal(await approveIncentive.count(), 0);
    incentiveDecision = null;
    await page.reload({ waitUntil: "domcontentloaded" });
    await incentive.getByRole("button", { name: "Recusar proposta de desconto", exact: true }).click();
    await incentive.getByRole("button", { name: "Confirmar recusa do desconto", exact: true }).click();
    await incentive.getByText("Proposta de desconto recusada.", { exact: true }).waitFor();
    assert.equal(posts.length, 0);
    incentiveDecision = null;
    await page.reload({ waitUntil: "domcontentloaded" });
    await approveIncentive.click(); incentiveFail = "conflict";
    await incentive.getByRole("button", { name: "Registrar aprovação do desconto", exact: true }).click();
    await incentive.getByText(/A decisão não foi aceita/).waitFor();
    assert.equal(await incentive.getByRole("button", { name: "Confirmar decisão do desconto", exact: true }).count(), 0);
    await approveIncentive.click(); incentiveFail = "unknown";
    await incentive.getByRole("button", { name: "Registrar aprovação do desconto", exact: true }).click();
    await incentive.getByText(/A confirmação não chegou/).waitFor();
    incentiveDecision = { ...incentiveDecision, kind: "withdraw", status: "withdrawn" };
    await retryIncentive.click();
    await incentive.getByText("A aprovação do desconto foi cancelada.", { exact: true }).waitFor();
    await retryIncentive.waitFor({ state: "detached" });
    assert.equal(await incentive.getByText("Proposta de desconto aprovada. O teste ainda não foi iniciado.", { exact: true }).count(), 0,
      "A historical approval receipt cannot replace the current withdrawn state");
    incentiveDecision = null; incentiveEnabled = false;
    for (const [reason, text] of [["insufficient_baseline", /menos de 100 compradores/], ["incomplete_history", /histórico excedeu o limite/],
      ["unusable_conversion_rate", /taxa de conversão deste público/]]) {
      const complete = reason !== "incomplete_history", buyers = complete ? 30 : 0;
      await refreshIncentive({ ...savedIncentive, planning: { ...savedIncentive.planning, blockers: [reason],
        baseline: { ...savedIncentive.planning.baseline, buyers, conversions: 0, complete },
        minimumBuyersPerArm: null, requiredBudgetCents: null, weeklyBuyersPerArm: complete ? Math.floor(buyers / 8) : null } });
      await incentive.getByText(text).waitFor();
      await incentive.getByText("Ainda não calculável", { exact: true }).waitFor();
    }
    for (const planning of [undefined, { ...savedIncentive.planning, definition: "future" },
      { ...savedIncentive.planning, minimumBuyersPerArm: -1 }, { ...savedIncentive.planning, blockers: ["future_reason"] },
      { ...savedIncentive.planning, status: "estimated_feasible", blockers: [] }]) {
      await refreshIncentive({ ...savedIncentive, planning });
      await incentive.getByText("Atualize o dashboard para consultar o planejamento deste teste.", { exact: true }).waitFor();
    }
    await refreshIncentive({ ...savedIncentive, definition: "weekly-incentive-recommendation-v1", planning: undefined,
      test: { ...savedIncentive.test, measurement: { ...savedIncentive.test.measurement, samplePlanning: "required_before_activation" } } });
    await incentive.getByText(/300,00 para até 30 usos/).waitFor();
    assert.equal(await incentive.getByRole("heading", { name: "Condições para medir o teste", exact: true }).count(), 0);
    for (const invalid of [
      { ...savedIncentive, definition: "future-format" },
      { ...savedIncentive, test: { ...savedIncentive.test, limitCents: -1 } },
      { ...savedIncentive, test: { ...savedIncentive.test, currency: "USD" } },
    ]) {
      review.versions[0].proposal.incentiveRecommendation = invalid;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Atualize o dashboard para consultar este formato de sugestão.", { exact: true }).waitFor();
      assert.equal(await page.getByText("Orçamento máximo sugerido", { exact: true }).count(), 0);
    }
    review.versions[0].proposal.incentiveRecommendation = { ...savedIncentive, status: "not_recommended", reason: "financial_policy_disabled", test: undefined };
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Os limites financeiros estavam desativados nesta análise/).waitFor();
    review.versions[0].proposal.incentiveRecommendation.reason = "no_safe_candidate";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: firstTitle, exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Teste de desconto sugerido", exact: true }).count(), 0);
    delete review.versions[0].proposal.incentiveRecommendation;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: firstTitle, exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Teste de desconto sugerido", exact: true }).count(), 0);
    review.versions[0].proposal.incentiveRecommendation = savedIncentive;
    review.versions[0].incentivePolicyCurrent = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await incentive.getByText(/300,00 para até 30 usos/).waitFor();
    assert.equal(posts.length, 0, "Review of incentive terms never sends a commercial decision");
    const discountStudy = page.getByRole("region", { name: "Simulação de desconto", exact: true });
    await discountStudy.getByText("46%", { exact: true }).waitFor();
    await discountStudy.getByText("A medir", { exact: true }).waitFor();
    await discountStudy.getByText(/Aprovar esta estratégia inicia somente o teste de comunicação/).waitFor();
    await discountStudy.getByText("Como a simulação foi calculada", { exact: true }).click();
    await discountStudy.getByText(/não é uma previsão de gasto nem um orçamento aprovado/).waitFor();
    await discountStudy.getByText(/não representa lucro líquido/).waitFor();
    await noOverflow(width);
    if (out) await discountStudy.screenshot({ path: `${out}/weekly-discount-study-${width}.png` });
    await discountStudy.getByText("Como a simulação foi calculada", { exact: true }).click();
    if (out) await discountStudy.screenshot({ path: `${out}/weekly-discount-summary-${width}.png` });
    const savedStudy = structuredClone(review.versions[0].proposal.discountStudy);
    delete review.versions[0].proposal.discountStudy;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: firstTitle, exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Simulação de desconto", exact: true }).count(), 0);
    review.versions[0].proposal.discountStudy = { ...savedStudy, status: "no_safe_candidate" };
    delete review.versions[0].proposal.discountStudy.candidate;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/não permitiram sugerir um desconto neste ciclo/).waitFor();
    assert.equal(await page.getByText("Desconto simulado", { exact: true }).count(), 0);
    review.versions[0].proposal.discountStudy = { ...savedStudy, definition: "future-discount-study" };
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Atualize o dashboard para consultar este formato de simulação/).waitFor();
    assert.equal(await page.getByText("Desconto simulado", { exact: true }).count(), 0);
    review.versions[0].proposal.discountStudy = savedStudy;
    await page.reload({ waitUntil: "domcontentloaded" });
    await discountStudy.getByText("46%", { exact: true }).waitFor();
    assert.equal(posts.length, 0, "Reading a study or an empty result never approves a strategy");
    await noOverflow(width);
    if (out) await page.screenshot({ path: `${out}/strategy-${width}.png`, fullPage: true });
    await requestAlternative();
    if (out) await page.screenshot({ path: `${out}/strategy-decision-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    assert.equal(await page.getByLabel("O que a IA deve considerar na alternativa?").inputValue(), "Prefiro explicar sem pressionar o comprador.");
    failAction = "unknown";
    await page.getByRole("button", { name: "Enviar pedido de alternativa" }).click();
    await page.getByRole("button", { name: "Confirmar envio", exact: true }).click();
    await page.getByText(/Pedido recebido. A IA preparará/).waitFor();
    assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]);
    assert.equal(review.actions.length, 1, "Retry reuses original receipt");
    await page.getByText("Aguardando disponibilidade", { exact: true }).waitFor();
    review.currentVersion = 2; review.versions = [version(2), version(1)]; review.status = "pending_review"; review.revision_available = true;
    review.actions[0].revision.status = "completed";
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByText(/Você está vendo uma versão anterior/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Recusar estratégia", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Ver versão atual", exact: true }).click();
    await page.getByRole("heading", { name: secondTitle, exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: secondTitle, exact: true }).waitFor();
    await page.getByLabel("Versão da proposta").selectOption("1");
    assert.equal(await page.getByRole("button", { name: "Pedir alternativa", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Ver versão atual", exact: true }).click();
    await page.getByRole("button", { name: "Recusar estratégia", exact: true }).click();
    await page.getByLabel("Motivo da recusa (opcional)").fill("Quero aguardar mais dados.");
    await page.getByRole("button", { name: "Confirmar recusa", exact: true }).click();
    await page.getByText("Estratégia recusada. Nenhuma alteração foi aplicada.", { exact: true }).waitFor();
    assert.equal(review.status, "rejected"); assert.equal(posts[2].input.version, 2);
    await page.getByRole("button", { name: "Voltar às sugestões" }).click();
    await page.getByRole("heading", { name: "Otimização de Checkout", exact: true }).waitFor();
    await page.getByText(secondTitle, { exact: true }).waitFor();
    await page.getByRole("button", { name: /Notificações/ }).click();
    await page.getByText("Nova versão da estratégia para revisar", { exact: true }).last().click();
    await page.getByRole("heading", { name: secondTitle, exact: true }).waitFor().catch(async error => {
      console.error("Notification destination", page.url(), (await page.locator("body").innerText()).slice(-4500));
      throw error;
    });
    assert.equal(page.url(), detail);
    await page.goBack();
    await page.getByRole("heading", { name: "Otimização de Checkout", exact: true }).waitFor();
    await page.goForward();
    await page.getByRole("heading", { name: secondTitle, exact: true }).waitFor();

    review = initialReview(); receipts.clear(); await page.reload({ waitUntil: "domcontentloaded" });
    await requestAlternative(); failAction = "conflict";
    await page.getByRole("button", { name: "Enviar pedido de alternativa" }).click();
    await page.getByText(/A proposta mudou. Confira/).waitFor();
    await page.getByText(/Você está vendo uma versão anterior/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Pedir alternativa", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Ver versão atual", exact: true }).click();
    await requestAlternative();
    readStatus = 503;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByText(/Os dados abaixo podem estar desatualizados/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Recusar estratégia", exact: true }).isDisabled(), true);
    readStatus = 200;
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await page.getByRole("button", { name: "Enviar pedido de alternativa" }).waitFor();
    assert.equal(await page.getByLabel("O que a IA deve considerar na alternativa?").inputValue(), "Prefiro explicar sem pressionar o comprador.");
    review.expired = true; review.revision_available = false; review.versions[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByText(/Esta proposta venceu. Você ainda/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Pedir alternativa", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Recusar estratégia", exact: true }).isEnabled(), true);
    readStatus = 403;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Sua conta não tem acesso/).waitFor();
    assert.equal(hypothesisReads, 0, "Forbidden or failed reads never fall back to legacy approval");
    readStatus = 404;
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await page.getByText(/Estratégia não encontrada nesta loja/).waitFor();
    assert.equal(hypothesisReads, 1);
    assert.deepEqual(legacyMutations, []);
    readStatus = 200; review = initialReview();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: firstTitle, exact: true }).waitFor();
    const population = page.getByText("Público e base de comparação", { exact: true });
    await population.focus(); await page.keyboard.press("Enter");
    await page.getByText(/Participa a primeira sessão elegível/).waitFor();
    await page.getByText(/A sessão e suas compras continuam na comparação/).waitFor();
    await page.getByText(/Se uma resposta do teste for bloqueada antes de ser publicada/).waitFor();
    review.versions[0].proposal.checkoutBaseline = undefined;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByText(/A sessão e suas compras continuam na comparação/).waitFor({ state: "hidden" });
    await page.getByText(/Se uma resposta do teste for bloqueada antes de ser publicada/).waitFor({ state: "hidden" });
    review.versions[0].proposal.checkoutBaseline = { contextExit: "checkout-context-exit-v1", suppressionRecovery: "checkout-suppression-recovery-v1" };
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByText(/A sessão e suas compras continuam na comparação/).waitFor();
    if (width === 390) { await page.setViewportSize({ width: 320, height: 800 }); await noOverflow(320); }
    else { await page.setViewportSize({ width: 720, height: 900 }); await noOverflow("200% equivalent"); }
    metricsState = "collecting";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Coletando resultados", exact: true }).waitFor();
    const results = page.getByRole("region", { name: "Resultados desta estratégia" });
    await results.getByRole("table").waitFor();
    assert.match(await results.getByRole("row", { name: /Sessões participantes/ }).innerText(), /100\s+100/);
    assert.match(await results.getByRole("row", { name: /Sessões que seguiram sem o experimento/ }).innerText(), /3\s+5/);
    assert.match(await results.innerText(), /permanecem no grupo original, incluindo suas compras/);
    assert.match(await results.getByRole("row", { name: /Conversão nas sessões encerradas/ }).innerText(), /10%\s+15%/);
    assert.match(await results.innerText(), /40 sessões ainda podem converter/);
    assert.match(await results.innerText(), /não representa receita incremental/);
    assert.match(await results.getByRole("row", { name: /Custo de produtos cadastrado/ }).innerText(), /500,00\s+Sem dados/);
    assert.match(await results.innerText(), /preservados para 19 de 21 pedidos/);
    assert.match(await results.getByRole("row", { name: /Taxas de pagamento confirmadas/ }).innerText(), /40,00\s+Sem dados/);
    assert.match(await results.innerText(), /Taxas da plataforma e do provedor confirmadas para 19 de 21 pedidos/);
    assert.match(await results.innerText(), /Valores planejados não entram nessa soma/);
    assert.match(await results.getByRole("row", { name: /IA das conversas do teste/ }).innerText(), /USD 0,000013\s+Sem dados/);
    assert.match(await results.innerText(), /Uso de IA conhecido em 169 de 170/);
    assert.match(await results.innerText(), /não é o valor faturado/);
    await noOverflow("metrics");
    if (out) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(`metrics ${width}`);
      await results.getByRole("row", { name: /Sessões que seguiram sem o experimento/ }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/strategy-metrics-${width}.png`, animations: "disabled" });
    }
    metricsFailure = true;
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByRole("alert").waitFor();
    assert.equal(await results.getByRole("table").count(), 1, "A failed refresh preserves the dated snapshot");
    metricsFailure = false; paymentCostMode = "zero";
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByRole("row", { name: /Taxas de pagamento confirmadas.*0,00.*Sem dados/ }).waitFor();
    paymentCostMode = "absent";
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByRole("row", { name: /Taxas de pagamento confirmadas/ }).waitFor({ state: "hidden" });
    assert.equal(await results.getByRole("table").count(), 1, "Historical measurements without payment costs remain readable");
    for (const mode of ["absent", "unknown"]) {
      participationMode = mode;
      await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
      await results.getByRole("button", { name: "Atualizar resultados", exact: true }).waitFor();
      assert.equal(await results.getByRole("row", { name: /Sessões que seguiram sem o experimento/ }).count(), 0);
      assert.equal(await results.getByRole("table").count(), 1, "Unknown or historical exit definitions do not become zero exits");
    }
    metricsFailure = false; metricsState = "positive";
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByRole("heading", { name: "Melhora de conversão observada" }).waitFor();
    await results.getByText(/Intervalo de confiança de 95%/).waitFor();
    await results.getByText(/Teste encerrado em/).waitFor();
    metricsState = "invalid";
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByText(/não pode fundamentar a adoção/).waitFor();
    await results.getByText(/Teste interrompido em/).waitFor();
    review.currentVersion = 2; review.versions = [version(2), version(1)];
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByRole("button", { name: "Ver versão atual", exact: true }).click();
    await results.getByText(/Esta versão ainda não foi ativada/).waitFor();
    assert.equal(await results.getByRole("table").count(), 0, "A new version never inherits the previous version's metrics");
    // An explicit current-version confirmation starts a test; a lost response
    // retries the same identity, including after the read already shows active.
    review = initialReview(); receipts.clear(); metricsState = null;
    review.approval_available = true; review.activation_available = true; review.activation_blockers = [];
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Aprovar estratégia", exact: true }).click();
    await page.getByRole("heading", { name: "Iniciar o teste da versão 1?", exact: true }).waitFor();
    await page.getByText("A simulação de desconto não será ativada por esta aprovação.", { exact: true }).waitFor();
    const beforeApproval = posts.length;
    await noOverflow(width);
    if (out) await page.screenshot({ path: `${out}/strategy-approval-${width}.png`, fullPage: true });
    failAction = "unknown";
    await page.getByRole("button", { name: "Aprovar e iniciar teste", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar envio", exact: true }).click();
    await page.getByText(/Aprovação confirmada. O teste desta versão foi iniciado/).waitFor();
    assert.equal(posts.length, beforeApproval + 2); assert.deepEqual(posts.at(-1), posts.at(-2));
    assert.ok(posts.at(-1).path.endsWith("/approve"));
    assert.equal(review.actions.filter(a => a.kind === "approve").length, 1);
    await page.getByText(/Esta versão está em teste/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Aprovar estratégia", exact: true }).isDisabled(), true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/Esta versão está em teste/).waitFor();
    assert.equal(posts.length, beforeApproval + 2);
    outcome = "insufficient_data";
    await page.getByRole("button", { name: "Voltar às sugestões" }).click();
    await page.getByText("Ver detalhes da análise", { exact: true }).click();
    await page.getByText(/Ainda precisamos de mais sessões/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Revisar estratégia", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: incentive approval, rejection, withdrawal, ambiguous retry, historical receipt, conflict and read failure; automatic terms, stale policy, unknown/invalid terms, no checkout activation; communication review, navigation, history, metrics and responsive behavior (mock API)`);
    await page.close();
  }
} finally { await browser.close(); }
