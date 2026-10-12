import { test, expect, type Page } from "@playwright/test";

// Browser exercises the real dashboard. API transport is mocked; PSP evidence belongs to API/PG tests.
async function mockApi(page: Page, options: { role?: string; expired?: boolean; error?: boolean; empty?: boolean; postFailure?: boolean; wrongReceipt?: boolean; invalidCurrency?: boolean } = {}) {
  const role = options.role ?? "owner";
  const state = { merchant: "host-a", postStatus: "pending", getStatus: "pending", listFailure: options.error ?? false,
    requests: [] as Array<{ path: string; method: string; body: any }>, posts: [] as any[] };
  const row = (id: string, status = "not_requested", can_request = true) => ({ payment_intent_id: id,
    amount_cents: 15000, currency: options.invalidCurrency ? "private_provider_data" : "BRL", created_at: "2026-09-30T15:00:00Z", status, can_request, reason: status === "not_requested" ? null : "duplicate" });
  await page.route("**/audit-api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/audit-api/v1", "");
    state.requests.push({ path, method: request.method(), body: request.postDataJSON() });
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/merchants/me") return json({ id: state.merchant, name: state.merchant === "host-a" ? "Loja Aurora" : "Loja Horizonte", user_id: "operator-test", role, plan: "BOTH" });
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: "starter", status: "canceled", trial_expired: options.expired ?? false, features: { marketplace: false } });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "host-a", name: "Loja Aurora", role }, { id: "host-b", name: "Loja Horizonte", role }] });
    if (path === "/merchants/me/stores/host-b/activate") { state.merchant = "host-b"; return json({ merchant_id: "host-b" }); }
    if (path === "/marketplace/dashboard/payments") {
      if (state.listFailure) return json({ message: "PRIVATE_ACCOUNT_SECRET" }, 503);
      const payments = options.empty || state.merchant === "host-b" ? [] : url.searchParams.has("cursor") ? [row("pay_older", "not_requested", false)] :
        [row("pay_aurora"), row("pay_pending", "pending", false), row("pay_cancelled", "cancelled", false), row("pay_blocked", "blocked", false)];
      return json({ payments, next_cursor: payments.length === 4 ? "pay_blocked" : null });
    }
    if (path.endsWith("/cancel")) {
      state.posts.push(request.postDataJSON());
      if (options.postFailure) return route.abort("connectionreset");
      return json({ payment_intent_id: options.wrongReceipt ? "pay_another_tenant" : path.split("/").at(-2), status: state.postStatus }, state.postStatus === "pending" ? 202 : 200);
    }
    if (path.endsWith("/cancellation")) return json({ payment_intent_id: path.split("/").at(-2), status: state.getStatus });
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  await page.route(/^https?:\/\/(?!localhost:5189)/, route => route.abort());
  return state;
}
const paymentRow = (page: Page, id = "pay_aurora") => page.getByRole("row").filter({ has: page.getByText(id, { exact: true }) });

test("operator confirms reason explicitly; pending GET refresh becomes cancelled without another POST", async ({ page }, info) => {
  const state = await mockApi(page);
  await page.goto("/#marketplace-payments");
  await expect(page.getByRole("heading", { name: "Cobranças do marketplace" })).toBeVisible();
  await expect(paymentRow(page)).toContainText("Não solicitado");
  await expect(paymentRow(page, "pay_pending")).toContainText("Aguardando confirmação");
  await expect(paymentRow(page, "pay_cancelled")).toContainText("Cancelamento confirmado");
  await expect(paymentRow(page, "pay_blocked")).toContainText("Cancelamento bloqueado");
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await expect(page.getByRole("button", { name: "Confirmar solicitação de cancelamento" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Revisar cancelamento" })).toBeFocused();
  await expect(page.locator(".platform-feedback-fab")).toBeHidden();
  await page.getByLabel("Motivo do cancelamento").selectOption("duplicate");
  expect(state.posts).toHaveLength(0);
  await page.locator(".marketplace-payments__confirmation").screenshot({ path: info.outputPath("confirmation.png") });
  await page.getByRole("button", { name: "Confirmar solicitação de cancelamento" }).click();
  await expect(paymentRow(page)).toContainText("Aguardando confirmação");
  expect(state.posts).toEqual([{ reason: "duplicate" }]);
  await expect(paymentRow(page).getByRole("button", { name: "Revisar cancelamento" })).toHaveCount(0);
  state.getStatus = "cancelled";
  await paymentRow(page).getByRole("button", { name: "Consultar estado" }).click();
  await expect(paymentRow(page)).toContainText("Cancelamento confirmado");
  expect(state.posts).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("cancelled.png"), fullPage: true });
});

test("lost POST response stays uncertain and GET never resubmits", async ({ page }) => {
  const state = await mockApi(page, { postFailure: true }); state.getStatus = "not_requested";
  await page.goto("/#marketplace-payments");
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await page.getByLabel("Motivo do cancelamento").selectOption("abandoned");
  await page.getByRole("button", { name: "Confirmar solicitação de cancelamento" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível confirmar");
  await expect(paymentRow(page)).toContainText("Solicitação sem confirmação");
  await paymentRow(page).getByRole("button", { name: "Consultar estado" }).click();
  await expect(paymentRow(page).getByRole("button", { name: "Revisar cancelamento" })).toHaveCount(0);
  await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(paymentRow(page)).toContainText("Solicitação sem confirmação");
  expect(state.posts).toHaveLength(1);
  await expect(page.locator("body")).not.toContainText("PRIVATE_ACCOUNT_SECRET");
});

test("pagination and leaving confirmation only read the API", async ({ page }) => {
  const state = await mockApi(page);
  await page.goto("/#marketplace-payments");
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await page.getByRole("button", { name: "Voltar sem cancelar" }).click();
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(paymentRow(page, "pay_older")).toContainText("Cancelamento indisponível");
  await expect(page.getByRole("button", { name: "Próxima", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect(paymentRow(page)).toBeVisible(); expect(state.posts).toHaveLength(0);
  expect(state.requests.filter(row => row.path.includes("/marketplace/")).every(row => row.method === "GET")).toBe(true);
});

test("neutral listing error can retry and empty state does not create an operation", async ({ page }) => {
  const state = await mockApi(page, { error: true, empty: true });
  await page.goto("/#marketplace-payments");
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.locator("body")).not.toContainText("PRIVATE_ACCOUNT_SECRET");
  state.listFailure = false;
  await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(page.getByText("Nenhuma cobrança do marketplace", { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(0);
});

test("staff cannot see a financial action or fetch payments even through direct navigation", async ({ page }) => {
  const state = await mockApi(page, { role: "staff" });
  await page.goto("/#marketplace-payments");
  await expect(page.getByRole("button", { name: "Revisar cancelamento" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(state.requests.filter(row => row.path.includes("/marketplace/dashboard/payments"))).toHaveLength(0);
});

test("expired plan permits only the authenticated financial remediation surface", async ({ page }, info) => {
  const state = await mockApi(page, { expired: true });
  await page.goto("/#marketplace-payments");
  await expect(paymentRow(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Voltar à assinatura" })).toBeVisible();
  await expect(page.locator(".dashboard-shell")).toHaveCount(0);
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await page.getByLabel("Motivo do cancelamento").selectOption("requested_by_customer");
  await page.getByRole("button", { name: "Confirmar solicitação de cancelamento" }).click();
  await expect(paymentRow(page)).toContainText("Aguardando confirmação");
  expect(state.posts).toHaveLength(1);
  await page.getByRole("button", { name: "Voltar à assinatura" }).click();
  await page.getByRole("button", { name: "Gerenciar cobranças existentes do marketplace" }).click();
  await expect(paymentRow(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath("expired-remediation.png"), fullPage: true });
});

test("switching merchants drops prior rows and unsubmitted confirmation", async ({ page }) => {
  const state = await mockApi(page);
  await page.goto("/#marketplace-payments");
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await page.getByLabel("Motivo do cancelamento").selectOption("fraudulent");
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
  await expect(page.getByText("Nenhuma cobrança do marketplace", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("pay_aurora");
  await expect(page.getByLabel("Motivo do cancelamento")).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

test("incompatible successful receipt remains uncertain without accepting another payment identity", async ({ page }) => {
  const state = await mockApi(page, { wrongReceipt: true }); state.postStatus = "cancelled";
  await page.goto("/#marketplace-payments");
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await page.getByLabel("Motivo do cancelamento").selectOption("duplicate");
  await page.getByRole("button", { name: "Confirmar solicitação de cancelamento" }).click();
  await expect(paymentRow(page)).toContainText("Solicitação sem confirmação");
  await expect(paymentRow(page).getByRole("button", { name: "Revisar cancelamento" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("pay_another_tenant");
  expect(state.posts).toHaveLength(1);
});

test("admin retains remediation access when the marketplace plan is inactive", async ({ page }) => {
  const state = await mockApi(page, { role: "admin", expired: true });
  await page.goto("/#marketplace-payments");
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await page.getByLabel("Motivo do cancelamento").selectOption("requested_by_customer");
  await page.getByRole("button", { name: "Confirmar solicitação de cancelamento" }).click();
  await expect(paymentRow(page)).toContainText("Aguardando confirmação");
  expect(state.posts).toHaveLength(1);
});

test("invalid financial list payload shows a neutral error without rendering untrusted values", async ({ page }) => {
  const state = await mockApi(page, { invalidCurrency: true });
  await page.goto("/#marketplace-payments");
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.locator("body")).not.toContainText("private_provider_data");
  await expect(page.getByRole("button", { name: "Revisar cancelamento" })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

test("authoritative GET closes a stale confirmation when the payment state changes", async ({ page }) => {
  const state = await mockApi(page); state.getStatus = "cancelled";
  await page.goto("/#marketplace-payments");
  await paymentRow(page).getByRole("button", { name: "Revisar cancelamento" }).click();
  await page.getByLabel("Motivo do cancelamento").selectOption("duplicate");
  await paymentRow(page).getByRole("button", { name: "Consultar estado" }).click();
  await expect(paymentRow(page)).toContainText("Cancelamento confirmado");
  await expect(page.getByRole("button", { name: "Confirmar solicitação de cancelamento" })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});
