import { expect, test, type Page } from "@playwright/test";
import type { CashbackBalance, CashbackCustomer, CashbackMetrics, CashbackProgramView, CashbackRules } from "@zyon/shared-types";

const rules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null, monthlyBudgetCents: 100000,
  releaseTrigger: "order_fulfilled", releaseDelayDays: 7, expiryDays: 90, minimumRedeemOrderCents: 5000, maximumRedeemBps: 2000, maximumRedeemCents: null,
  allowWithDiscounts: false,
  combination: { allowCoupons: false, allowAdvancedRules: false, limitMode: "cashback_specific", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null },
  terms: "Crédito em reais para novas compras na mesma loja, com validade de 90 dias após liberação." };
const balance: CashbackBalance = { pendingCents: 1200, availableCents: 3000, reservedCents: 500, earnedCents: 5000, usedCents: 300, expiredCents: 0, reversedCents: 0, lossCents: 0, nextExpiryAt: "2026-12-20T02:59:59Z", nextExpiryCents: 1000 };
const customer: CashbackCustomer = { buyerId: "canonical-ana", displayName: "Ana Silva", email: "ana@example.test", balance, lastUsedAt: "2026-11-12T16:00:00Z", ordersWithCashback: 2 };
const metrics: CashbackMetrics = { from: "2026-11-01T03:00:00Z", to: "2026-11-15T02:59:59Z", asOf: "2026-11-14T12:00:00Z", grantedCents: 5000, releasedCents: 3800, redeemedCents: 300, restoredCents: 0,
  expiredCents: 0, reversedCents: 0, lossCents: 0, pendingCents: 1200, availableCents: 3000, reservedCents: 500, buyersGranted: 1, buyersRedeemed: 1, ordersWithCashback: 2,
  associatedRevenueCents: 25000, budgetCommittedCents: 1500, budgetIssuedCents: 5000, budgetLimitCents: 100000 };

async function fixture(page: Page, options: { active?: boolean; failMetrics?: boolean; failCustomers?: boolean; failSave?: boolean; holdMetrics?: boolean; empty?: boolean } = {}) {
  let program: CashbackProgramView = { merchantId: "cashback-store", status: options.active ? "active" : "disabled", draft: options.active ? rules : null, published: options.active ? rules : null, version: options.active ? 1 : 0, updatedAt: null };
  let currentBalance = { ...balance };
  const requests: Array<{ path: string; params: Record<string, string>; method: string; body: any }> = [];
  let metricsFailure = !!options.failMetrics, customerFailure = !!options.failCustomers, saveFailure = !!options.failSave;
  let releaseMetrics = () => {};
  const metricsGate = options.holdMetrics ? new Promise<void>(resolve => { releaseMetrics = resolve; }) : Promise.resolve();
  await page.route("**/cashback-test-api/v1/dashboard/cashback/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    const path = url.pathname.split("/dashboard/cashback/")[1];
    const body = request.postData() ? request.postDataJSON() : undefined;
    requests.push({ path, params: Object.fromEntries(url.searchParams), method: request.method(), body });
    if (path === "program") {
      if (request.method() === "PATCH" && saveFailure) { saveFailure = false; return route.fulfill({ status: 503, json: { message: "unavailable" } }); }
      if (request.method() === "PATCH") program = { ...program, draft: body.rules, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: program });
    }
    if (path === "program/publish") { program = { ...program, status: "active", published: program.draft as CashbackRules, version: program.version + 1, updatedAt: new Date().toISOString() }; return route.fulfill({ json: program }); }
    if (path === "program/pause" || path === "program/end") { program = { ...program, status: path.endsWith("pause") ? "paused" : "ended", updatedAt: new Date().toISOString() }; return route.fulfill({ json: program }); }
    if (path === "metrics") { await metricsGate; if (metricsFailure) { metricsFailure = false; return route.fulfill({ status: 503, json: { message: "unavailable" } }); } return route.fulfill({ json: metrics }); }
    if (path === "customers") {
      if (customerFailure) { customerFailure = false; return route.fulfill({ status: 503, json: { message: "unavailable" } }); }
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      const item = pageNumber === 2 ? { ...customer, buyerId: "canonical-bruno", displayName: "Bruno Costa", email: "bruno@example.test" } : customer;
      return route.fulfill({ json: { items: options.empty ? [] : [item], total: options.empty ? 0 : 11, page: pageNumber, pageSize: 10 } });
    }
    if (path === "customers/canonical-ana") return route.fulfill({ json: { merchantId: "cashback-store", buyerId: customer.buyerId, currency: "BRL", balance: currentBalance, program: { status: program.status, version: program.version, published: program.published } } });
    if (path === "customers/canonical-ana/adjustments") { currentBalance = { ...currentBalance, availableCents: currentBalance.availableCents + body.amountCents }; return route.fulfill({ json: { merchantId: "cashback-store", buyerId: customer.buyerId, currency: "BRL", balance: currentBalance, program: { status: program.status, version: program.version, published: program.published } } }); }
    if (path === "transactions") return route.fulfill({ json: { items: options.empty ? [] : [{ id: "movement-1", merchantId: "cashback-store", buyerId: customer.buyerId, type: "redeem", amountCents: 300, orderId: "order-1", sessionId: "session-1", reason: "Cashback usado em compra pelo WhatsApp", actorId: null, occurredAt: "2026-11-12T16:00:00Z" }], total: options.empty ? 0 : 1, page: 1, pageSize: 10 } });
    if (path === "exports") return route.fulfill({ contentType: "text/csv", body: "cliente,valor\nAna Silva,30.00\n" });
    return route.fulfill({ status: 404, json: { message: "unexpected_test_route" } });
  });
  await page.goto("/e2e/fixtures/cashback.html");
  await expect(page.getByRole("heading", { name: "Cashback", exact: true })).toBeVisible();
  return { requests, program: () => program, releaseMetrics };
}
async function fillRules(page: Page) {
  await page.getByLabel("Percentual de cashback (%)", { exact: true }).fill("5");
  await page.getByLabel("Compra mínima para ganhar (R$)", { exact: true }).fill("0");
  await page.getByLabel("Ganho máximo por pedido", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Ganho máximo por cliente no mês", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Orçamento mensal da loja", { exact: true }).selectOption("limited");
  await page.getByLabel("Orçamento mensal da loja — valor em R$", { exact: true }).fill("1000");
  await page.getByLabel("Marco de liberação", { exact: true }).selectOption("order_fulfilled");
  await page.getByLabel("Carência após o marco (dias)", { exact: true }).fill("7");
  await page.getByLabel("Validade do crédito", { exact: true }).selectOption("limited");
  await page.getByLabel("Validade após a liberação (dias)", { exact: true }).fill("90");
  await page.getByLabel("Compra mínima para usar (R$)", { exact: true }).fill("50");
  await page.getByLabel("Limite de uso por compra (%)", { exact: true }).fill("20");
  await page.getByLabel("Valor máximo de uso por compra", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Combinar cashback com cupons", { exact: true }).selectOption("no");
  await page.getByLabel("Combinar cashback com regras avançadas", { exact: true }).selectOption("no");
  await page.getByLabel("Qual teto deve prevalecer?", { exact: true }).selectOption("cashback_specific");
  await page.getByLabel("Teto conjunto em percentual", { exact: true }).selectOption("limited");
  await page.getByLabel("Teto conjunto dos benefícios (%)", { exact: true }).fill("30");
  await page.getByLabel("Teto conjunto em reais", { exact: true }).selectOption("unlimited");
  await page.getByLabel("Condições do cashback", { exact: true }).fill(rules.terms);
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function screenshot(page: Page, name: string) { await page.screenshot({ path: `../../.specs/features/cashback-stacking/evidence/dashboard-regression-${name}-${test.info().project.name}.png`, fullPage: true }); }

test("CB-01 CB-02 blank commercial rules reject activation and partial drafts reload without implicit values", async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole("button", { name: "Configurar cashback", exact: true }).click();
  const fields = page.locator('.cashback-settings input, .cashback-settings select, .cashback-settings textarea');
  expect(await fields.evaluateAll(elements => elements.every(element => (element as HTMLInputElement).value === ""))).toBe(true);
  await page.getByRole("button", { name: "Revisar e publicar" }).click();
  await expect(page.getByRole("alert")).toHaveCount(17);
  await expect(page.getByRole("alert").filter({ hasText: "combinar com cupons" })).toHaveCount(1);
  await expect(page.getByRole("alert").filter({ hasText: "combinar com regras avançadas" })).toHaveCount(1);
  await expect(page.getByRole("alert").filter({ hasText: "qual teto deve prevalecer" })).toHaveCount(1);
  expect(app.requests.filter(request => request.path === "program/publish")).toHaveLength(0);
  await page.getByLabel("Percentual de cashback (%)", { exact: true }).fill("2,75");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("status")).toContainText("Rascunho salvo");
  expect(app.requests.find(request => request.method === "PATCH")?.body).toEqual({ rules: { earnRateBps: 275 } });
  await noOverflow(page); await screenshot(page, "draft");
  await page.reload(); await page.getByRole("button", { name: "Configuração", exact: true }).click();
  await expect(page.getByLabel("Percentual de cashback (%)", { exact: true })).toHaveValue("2,75");
  await expect(page.getByLabel("Compra mínima para ganhar (R$)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Validade do crédito", { exact: true })).toHaveValue("");
});

test("CB-03 CB-21 merchant fills, reviews, publishes and pauses while existing credits remain visible", async ({ page }) => {
  const app = await fixture(page);
  await page.getByRole("button", { name: "Configurar cashback", exact: true }).click();
  await fillRules(page); await page.getByRole("button", { name: "Revisar e publicar" }).click();
  await expect(page.getByRole("heading", { name: "Confira antes de ativar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confira antes de ativar" })).toBeInViewport();
  await page.getByLabel("Valor dos produtos para simular (R$)", { exact: true }).fill("200");
  await expect(page.getByRole("status").filter({ hasText: "Ganho estimado com esse uso:" })).toContainText("R$ 8,00");
  await expect(page.getByRole("status").filter({ hasText: "Cashback máximo nesta compra:" })).toContainText("R$ 40,00");
  await expect(page.getByRole("status").filter({ hasText: "Produtos após todos os benefícios:" })).toContainText("R$ 160,00");
  expect(app.requests.filter(request => request.path === "program/publish")).toHaveLength(0);
  await screenshot(page, "review"); await page.getByRole("button", { name: "Publicar e ativar" }).click();
  await expect(page.getByRole("status")).toContainText("Cashback publicado");
  expect(app.program().published).toEqual(rules); expect(app.program().version).toBe(1);
  expect(app.program().published?.combination).toEqual({ allowCoupons: false, allowAdvancedRules: false, limitMode: "cashback_specific", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null });
  await page.getByRole("button", { name: "Pausar novos ganhos", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Créditos já prometidos ou concedidos");
  await page.getByRole("dialog").getByRole("button", { name: "Pausar novos ganhos", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Novos ganhos pausados");
  await page.getByRole("button", { name: "Visão geral", exact: true }).click();
  await expect(page.getByRole("definition").filter({ hasText: "30,00" }).first()).toBeVisible();
  await expect(page.getByText("Receita dos pedidos em que houve uso de cashback.")).toBeVisible();
  await noOverflow(page); await screenshot(page, "overview-paused");
});

test("CB-18 CB-22 canonical customers use server filters, pagination, export and an explicitly reviewed adjustment", async ({ page }) => {
  const app = await fixture(page, { active: true });
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ana Silva", exact: true })).toHaveCount(1);
  await page.getByPlaceholder("Buscar cliente por nome ou e-mail").fill("Ana");
  await expect.poll(() => app.requests.filter(request => request.path === "customers").at(-1)?.params.q).toBe("Ana");
  await page.getByRole("button", { name: "Já utilizaram", exact: true }).click();
  await expect.poll(() => app.requests.filter(request => request.path === "customers").at(-1)?.params.filter).toBe("used");
  const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Exportar clientes" }).click(); await downloadEvent;
  expect(app.requests.find(request => request.path === "exports")?.params).toMatchObject({ kind: "customers", q: "Ana", filter: "used" });
  await page.getByPlaceholder("Buscar cliente por nome ou e-mail").fill("");
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await expect.poll(() => app.requests.filter(request => request.path === "customers").at(-1)?.params.q).toBeUndefined();
  await page.getByRole("button", { name: "Próxima página", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bruno Costa", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Página anterior", exact: true }).click();
  await page.getByRole("button", { name: "Ana Silva", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ana Silva", exact: true })).toBeVisible();
  await expect(page.getByText("Cashback usado em compra pelo WhatsApp", { exact: true })).toBeVisible();
  await screenshot(page, "customer"); await noOverflow(page);
  await page.getByRole("button", { name: "Registrar ajuste", exact: true }).click();
  await page.getByRole("combobox", { name: "Tipo de ajuste", exact: true }).selectOption("credit");
  await page.getByLabel("Valor do ajuste (R$)", { exact: true }).fill("12,50");
  await page.getByLabel("Motivo do ajuste", { exact: true }).fill("Correção autorizada do pedido de teste");
  await page.getByRole("button", { name: "Revisar ajuste", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Escolha sem vencimento");
  expect(app.requests.filter(request => request.path.endsWith("/adjustments"))).toHaveLength(0);
  await page.getByRole("combobox", { name: "Validade do ajuste", exact: true }).selectOption("none");
  await page.getByRole("button", { name: "Revisar ajuste", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Adicionar R$ 12,50");
  await page.getByRole("dialog").getByRole("button", { name: "Registrar ajuste", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ajuste registrado" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "42,50" })).toBeVisible();
  expect(app.requests.find(request => request.path.endsWith("/adjustments"))?.body).toMatchObject({ amountCents: 1250, reason: "Correção autorizada do pedido de teste", expiryDays: null });
});

test("CB-21 unavailable metrics are not zero, retry recovers, and empty customers/extract explain their state", async ({ page }) => {
  await fixture(page, { active: true, failMetrics: true, empty: true });
  await expect(page.getByText("Informações indisponíveis", { exact: true })).toBeVisible();
  await expect(page.getByText("Saldo atual do programa", { exact: true })).toHaveCount(0);
  await screenshot(page, "error");
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saldo atual do programa", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await expect(page.getByText("Os clientes aparecerão após o primeiro crédito", { exact: true })).toBeVisible();
  await screenshot(page, "empty"); await noOverflow(page);
  await page.getByRole("button", { name: "Extrato", exact: true }).click();
  await expect(page.getByText("Nenhuma movimentação neste período", { exact: true })).toBeVisible();
});

test("CB-21 loading waits for server values instead of presenting a zero balance", async ({ page }) => {
  const app = await fixture(page, { active: true, holdMetrics: true });
  await expect(page.getByRole("status", { name: "Carregando métricas…" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saldo atual do programa" })).toHaveCount(0);
  await screenshot(page, "loading"); app.releaseMetrics();
  await expect(page.getByRole("heading", { name: "Saldo atual do programa" })).toBeVisible();
});

test("CB-21 failed draft save preserves the merchant's values and allows a safe retry", async ({ page }) => {
  const app = await fixture(page, { failSave: true });
  await page.getByRole("button", { name: "Configurar cashback", exact: true }).click();
  await fillRules(page); await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("alert")).toContainText("Seus dados foram mantidos");
  await expect(page.getByLabel("Percentual de cashback (%)", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("Condições do cashback", { exact: true })).toHaveValue(rules.terms);
  expect(app.program().status).toBe("disabled");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rascunho salvo" })).toBeVisible();
  expect(app.program().draft).toEqual(rules); expect(app.requests.filter(request => request.path === "program/publish")).toHaveLength(0);
});
