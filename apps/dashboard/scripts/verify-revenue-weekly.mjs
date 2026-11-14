import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.REVENUE_UI_TEST_URL ?? "http://127.0.0.1:5186";
if (new URL(base).hostname !== "127.0.0.1") throw new Error("Use a local dashboard; this test mocks API responses.");
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", error => console.error(error.message));
    let approved = false;
    let outcome = "recommendations";
    const proposal = { id: "proposal-fixture", hypothesis_text: "Explicar as opções de pagamento com mais clareza",
      reasoning: "A análise identificou dificuldades na etapa de pagamento.", expected_lift_percent: 0,
      risk_level: "low", status: "pending_review", created_at: "2026-09-24T06:00:00Z", template: {
        variant_a: { name: "Atual", system_prompt: "Ajude o comprador.", is_control: true },
        variant_b: { name: "Comunicação", system_prompt: "Explique as opções disponíveis.", is_control: false } } };
    await page.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === base && !url.pathname.startsWith("/api/")) return route.continue();
      if (!["fetch", "xhr"].includes(request.resourceType())) return route.abort();
      const path = url.pathname;
      let body = {};
      let responseStatus = 200;
      if (path.endsWith("/merchants/me")) body = { id: "merchant-fixture", name: "Loja de teste", user_id: "owner", role: "OWNER", plan: "BOTH" };
      else if (path.endsWith("/onboarding")) body = { completed: true, steps: [] };
      else if (path.endsWith("/billing/subscription")) body = { plan: "scale", planKey: "scale", status: "active", effectivePlan: "scale", features: { revenueManager: true }, currentPeriodEnd: "2099-01-01T00:00:00Z" };
      else if (path.endsWith("/rules")) body = { autonomousEngineEnabled: true };
      else if (path.endsWith("/notifications")) body = { items: [{ id: "analysis:fixture", type: "ai_analysis_update",
        title: "Sua análise semanal foi concluída", createdAt: "2026-09-24T06:00:00Z", metadata: { analysisRunId: "fixture" } }] };
      else if (path.endsWith("/analysis-status")) body = { mode: "weekly", enabled: true, queue_available: true,
        next_eligible_at: "2026-10-01T06:00:00Z", last_successful_at: "2026-09-24T06:00:00Z", overdue: false,
        run: { id: "fixture", status: "completed", result: outcome, reason: null, createdAt: "2026-09-24T06:00:00Z",
          completedAt: "2026-09-24T06:01:00Z", hypothesisId: outcome === "recommendations" ? proposal.id : null } };
      else if (path.endsWith("/hypotheses")) body = outcome === "recommendations" ? [proposal] : [];
      else if (path.endsWith(`/hypotheses/${proposal.id}`)) body = { ...proposal, status: approved ? "experiment_created" : "pending_review" };
      else if (path.endsWith(`/strategies/${proposal.id}`)) { responseStatus = 404; body = { message: "STRATEGY_NOT_FOUND" }; }
      else if (path.endsWith("/approve")) { approved = true; body = { status: "experiment_created", experiment_id: "experiment-fixture" }; }
      else if (path.endsWith("/observations")) body = [{ id: "obs", observation_window_start: "2026-09-17T06:00:00Z",
        funnel: { total_sessions: 100, conversion_rate: 0.2 }, abandonment: { top_abandonment_objection: "payment" }, objections: {} }];
      else if (path.endsWith("/strategy-lessons")) body = [];
      await route.fulfill({ status: responseStatus, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`${base}/#revenue-manager`, { waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "Análise semanal" }).waitFor({ timeout: 20_000 }).catch(async error => {
      console.error((await page.locator("body").innerText()).slice(0, 1800)); throw error;
    });
    await page.getByText("Ver detalhes da análise", { exact: true }).click();
    await page.getByText("Estratégia pronta para sua revisão", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Revisar estratégia", exact: true }).click();
    await page.getByRole("button", { name: "Iniciar teste A/B", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Iniciar teste A/B", exact: true }).isDisabled(), true);
    assert.equal(approved, false, "Legacy proposal cannot activate a weekly experiment");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("region", { name: "Análise semanal" }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `No horizontal overflow at ${width}px`);
    await page.getByRole("button", { name: /Notificações/ }).click();
    await page.getByText("Sua análise semanal foi concluída", { exact: true }).last().click();
    assert.match(page.url(), /#revenue-manager$/);
    outcome = "insufficient_data";
    await page.reload({ waitUntil: "domcontentloaded" });
    const summary = page.getByText("Ver detalhes da análise", { exact: true });
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.getByText(/Ainda precisamos de mais sessões/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Revisar estratégia", exact: true }).count(), 0);
    if (process.env.REVENUE_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.REVENUE_UI_SCREENSHOT_DIR}/weekly-${width}.png`, fullPage: true });
    console.log(`PASS ${width}px: weekly legacy details, approval blocked, reload, notification, keyboard and insufficient data (mock API)`);
    await page.close();
  }
} finally { await browser.close(); }
