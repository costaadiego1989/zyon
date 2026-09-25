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
  return { version: n, proposalHash: String(n).repeat(64), createdAt: stamp, expiresAt: expires,
    proposal: { definition: "checkout-strategy-review-v1", execution: "unavailable", expectedLiftStatus: "model_estimate_not_measured",
      baselineStatus: "primary_chat_contract_captured",
      recommendation: { hypothesis_text: n === 1 ? firstTitle : secondTitle, reasoning: "A análise identificou dificuldades na etapa de pagamento.",
        expected_lift_percent: 2, template: { description: "Explicar as opções verificadas, sem oferecer descontos adicionais.",
          variant_a: { name: "Atual", system_prompt: "checkout-chat-baseline-v1:fixture", weight: 50, is_control: true },
          variant_b: { name: "Comunicação", system_prompt: "Pergunte qual etapa precisa de explicação e use apenas dados verificados.", weight: 50, is_control: false } } },
      rules: { maxDiscountPercent: 10, minimumMarginPercent: 38, allowFreeShipping: false, maxShippingSubsidy: 0 },
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
    let metricsState = null, metricsFailure = false;
    const posts = [], legacyMutations = [], receipts = new Map();
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
      else if (path.endsWith(`/strategies/${review.id}/metrics`)) {
        const input = req.postDataJSON(); assert.deepEqual(Object.keys(input), ["version"]);
        const metricVersion = input.version;
        if (metricsFailure) { status = 503; body = { message: "Unavailable" }; }
        else {
          const active = metricsState && metricVersion === 1;
          const arm = { assigned: 100, mature: 80, converted: 8, orders: 9, revenueCents: 100000 };
          const delivery = { assigned: 100, mature: 80, pending: 20, sessionsWithPublication: 70, sessionsWithDisplay: 60 };
          body = { strategyId: review.id, version: metricVersion,
            execution: active ? { id: "execution-fixture", proposalHash: "1".repeat(64), status: "running", startedAt: stamp, endsAt: expires, stoppedAt: null } : null,
            measurement: active ? { collectedAt: stamp, evidenceHash: "e".repeat(64), result: {
              definitionVersion: "session-conversion-fixed-horizon-v1", state: metricsState, reasons: [], asOf: stamp, matureAt: expires,
              control: arm, treatment: { ...arm, converted: 12, orders: 12, revenueCents: 150000 }, minimumSessionsPerArm: 14800,
              interval: metricsState === "positive" ? { effectBps: 500, lowerBps: 100, upperBps: 900 } : null,
              contributionCents: null, aiCostCents: null, promotionAllowed: false,
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
          assert.deepEqual(Object.keys(input).sort(), ["feedback", "proposal_hash", "request_key", "version"]);
          const revision = path.endsWith("/revisions");
          body = { action_id: `action-${posts.length}`, strategy_id: review.id, version: input.version, proposal_hash: input.proposal_hash,
            status: revision ? "revision_requested" : "rejected" };
          receipts.set(input.request_key, body);
          review.status = revision ? "revision_pending" : "rejected"; review.revision_available = false;
          review.actions.unshift({ id: body.action_id, version: input.version, kind: revision ? "revision" : "reject", feedback: input.feedback,
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
    if (width === 390) { await page.setViewportSize({ width: 320, height: 800 }); await noOverflow(320); }
    else { await page.setViewportSize({ width: 720, height: 900 }); await noOverflow("200% equivalent"); }
    metricsState = "collecting";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Coletando resultados", exact: true }).waitFor();
    const results = page.getByRole("region", { name: "Resultados desta estratégia" });
    await results.getByRole("table").waitFor();
    assert.match(await results.getByRole("row", { name: /Sessões participantes/ }).innerText(), /100\s+100/);
    assert.match(await results.getByRole("row", { name: /Conversão nas sessões encerradas/ }).innerText(), /10%\s+15%/);
    assert.match(await results.innerText(), /40 sessões ainda podem converter/);
    assert.match(await results.innerText(), /não representa receita incremental/);
    assert.match(await results.getByRole("row", { name: /Custo de produtos cadastrado/ }).innerText(), /500,00\s+Sem dados/);
    assert.match(await results.innerText(), /preservados para 19 de 21 pedidos/);
    await noOverflow("metrics");
    if (out) await results.screenshot({ path: `${out}/strategy-metrics-${width}.png` });
    metricsFailure = true;
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByRole("alert").waitFor();
    assert.equal(await results.getByRole("table").count(), 1, "A failed refresh preserves the dated snapshot");
    metricsFailure = false; metricsState = "positive";
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByRole("heading", { name: "Melhora de conversão observada" }).waitFor();
    await results.getByText(/Intervalo de confiança de 95%/).waitFor();
    metricsState = "invalid";
    await results.getByRole("button", { name: "Atualizar resultados", exact: true }).click();
    await results.getByText(/não pode fundamentar a adoção/).waitFor();
    review.currentVersion = 2; review.versions = [version(2), version(1)];
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.getByRole("button", { name: "Ver versão atual", exact: true }).click();
    await results.getByText(/Esta versão ainda não foi ativada/).waitFor();
    assert.equal(await results.getByRole("table").count(), 0, "A new version never inherits the previous version's metrics");
    outcome = "insufficient_data";
    await page.getByRole("button", { name: "Voltar às sugestões" }).click();
    await page.getByText("Ver detalhes da análise", { exact: true }).click();
    await page.getByText(/Ainda precisamos de mais sessões/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Revisar estratégia", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: direct/reload, notice, navigation, revision, ambiguous retry, exact version, conflict, history, reject, expiry, access, keyboard, responsive, insufficient data, measured/pending results, refresh failure, positive/invalid evidence, metrics version isolation (mock API)`);
    await page.close();
  }
} finally { await browser.close(); }
