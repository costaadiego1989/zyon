import { test, expect, type Page } from "@playwright/test";

// Chromium renders the real dashboard. API state and auth are simulated on
// loopback; all non-loopback HTTP is denied and no PSP is contacted.
const root = "/marketplace/dashboard/asaas-wallet-returns";
const requestHash = "a".repeat(64);
async function mockApi(page: Page, options: { role?: string; noAuth?: boolean; lost?: boolean; wrongReceipt?: boolean } = {}) {
  const state = { merchant: "seller-a", status: null as null | "claimed" | "pending" | "returned", empty: false,
    listError: false, getState: "returned" as "claimed" | "pending" | "returned", posts: [] as Array<{ path: string; body: unknown }>,
    requests: [] as Array<{ path: string; method: string }> };
  const role = options.role ?? "owner";
  function journal(status = state.status ?? "claimed") {
    return { id: "journal_aurora", refund_id: "refund_aurora", payout_id: "payout_aurora", amount_cents: 8500, currency: "BRL",
      request_hash: requestHash, status, can_execute: status === "claimed", certificate_hash: status === "returned" ? "c".repeat(64) : null };
  }
  function entry(older = false) {
    return { refund_id: older ? "refund_older" : "refund_aurora", payout_id: older ? "payout_older" : "payout_aurora",
      return_id: older ? "return_older" : "return_aurora", created_at: "2026-10-03T00:00:00.000Z", host_name: "Loja anfitriã Girassol",
      amount_cents: 8500, currency: "BRL", environment: "test", payment_method: "pix", journal: older ? null : state.status ? journal() : null };
  }
  await page.route("**/audit-api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/audit-api/v1", "");
    state.requests.push({ path, method: request.method() });
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/merchants/me") return options.noAuth ? json({}, 401) : json({ id: state.merchant, name: state.merchant === "seller-a" ? "Loja Aurora" : "Loja Horizonte", user_id: "owner-fixture", role, plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: "starter", status: "canceled", trial_expired: false, features: {} });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "seller-a", name: "Loja Aurora", role }, { id: "seller-b", name: "Loja Horizonte", role }] });
    if (path === "/merchants/me/stores/seller-b/activate") { state.merchant = "seller-b"; return json({ merchant_id: "seller-b" }); }
    if (path === root) {
      if (state.listError) return json({ message: "PRIVATE_PROVIDER_TOKEN" }, 503);
      return json({ entries: state.empty || state.merchant === "seller-b" ? [] : [entry(url.searchParams.has("cursor"))],
        next_cursor: state.empty || state.merchant === "seller-b" || url.searchParams.has("cursor") ? null : "cursor_older" });
    }
    if (path === `${root}/refunds/refund_aurora/payouts/payout_aurora/approve`) {
      state.posts.push({ path, body: request.postDataJSON() }); state.status = "claimed"; return json(journal());
    }
    if (path === `${root}/journal_aurora/execute`) {
      state.posts.push({ path, body: request.postDataJSON() });
      if (options.lost) return route.abort("connectionreset");
      state.status = "pending";
      return json({ ...journal(), ...(options.wrongReceipt ? { payout_id: "foreign_payout" } : {}) });
    }
    if (path === `${root}/journal_aurora`) { state.status = state.getState; return json(journal()); }
    if (path.startsWith(`${root}/refunds/`)) return json(state.status ? journal() : {
      refund_id: "refund_aurora", payout_id: "payout_aurora", amount_cents: 8500, currency: "BRL", status: "awaiting_consent", can_execute: false });
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  await page.route(/^https?:\/\/(?!localhost:5196)/, route => route.abort());
  return state;
}
const row = (page: Page) => page.getByTestId("wallet-return-refund_aurora-payout_aurora");
async function review(page: Page) { await row(page).getByRole("button", { name: "Revisar retorno" }).click(); }
async function approve(page: Page) {
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Registrar autorização" }).click();
  await expect(page.getByRole("button", { name: "Confirmar envio do retorno" })).toBeDisabled();
}
async function execute(page: Page) { await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirmar envio do retorno" }).click(); }

test("discovery, preview, seller consent and explicit one-use execution preserve financial hierarchy", async ({ page }, info) => {
  const state = await mockApi(page); await page.goto("/#marketplace-asaas-wallet-returns");
  await expect(page.getByRole("heading", { name: "Retornos Asaas", exact: true })).toBeVisible(); expect(state.posts).toHaveLength(0);
  await review(page); await expect(page.getByRole("heading", { name: "Revisar retorno do repasse" })).toBeFocused();
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("Valor integral do repasse a retornar");
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("R$ 85,00");
  await expect(page.getByRole("button", { name: "Registrar autorização" })).toBeDisabled();
  await approve(page); expect(state.posts).toHaveLength(1);
  expect(state.posts[0].body).toEqual({ confirmed: true, expected_amount_cents: 8500 });
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Confirmar envio do retorno" }).scrollIntoViewIfNeeded();
  await expect(page.locator(".platform-feedback-fab")).toBeHidden(); await page.screenshot({ path: info.outputPath("explicit-return-confirmation.png"), fullPage: true });
  await page.getByRole("button", { name: "Confirmar envio do retorno" }).click();
  await expect(row(page)).toContainText("Aguardando confirmação"); expect(state.posts).toHaveLength(2);
  expect(state.posts[1].body).toEqual({ confirmed: true, expected_amount_cents: 8500, expected_request_hash: requestHash });
  await row(page).getByRole("button", { name: "Consultar estado", exact: true }).click();
  await expect(row(page)).toContainText("Retorno confirmado"); expect(state.posts).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Confirmar envio do retorno" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("returned.png"), fullPage: true });
});

test("lost execution response remains GET-only after stale claimed refresh and full reload", async ({ page }) => {
  const state = await mockApi(page, { lost: true }); state.getState = "claimed";
  await page.goto("/#marketplace-asaas-wallet-returns"); await review(page); await approve(page); await execute(page);
  await expect(page.getByRole("alert")).toContainText("esta solicitação não será reenviada");
  await row(page).getByRole("button", { name: "Consultar estado", exact: true }).click();
  await expect(row(page)).toContainText("Envio sem confirmação");
  await page.reload(); await review(page); await expect(page.getByRole("button", { name: "Confirmar envio do retorno" })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0); expect(state.posts).toHaveLength(2);
  const before = state.requests.length; await page.getByRole("button", { name: "Consultar estado do retorno" }).click();
  expect(state.requests.slice(before).filter(request => request.path.startsWith(root)).every(request => request.method === "GET")).toBe(true);
  state.getState = "returned"; await page.getByRole("button", { name: "Consultar estado do retorno" }).click();
  await expect(row(page)).toContainText("Retorno confirmado"); expect(state.posts.filter(post => post.path.endsWith("/execute"))).toHaveLength(1);
});

test("tenant switch discards consent, details and foreign pagination without issuing commands", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#marketplace-asaas-wallet-returns"); await review(page); await page.getByRole("checkbox").check();
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
  await expect(page.getByText("Nenhum retorno disponível", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0); await expect(row(page)).toHaveCount(0); expect(state.posts).toHaveLength(0);
});

test("pagination, empty states and neutral errors remain local GET-only reads", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#marketplace-asaas-wallet-returns");
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await expect(page.getByText("return_older", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anterior", exact: true }).click(); await expect(row(page)).toBeVisible();
  state.listError = true; await page.getByRole("button", { name: "Atualizar lista" }).click(); await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.locator("body")).not.toContainText("PRIVATE_PROVIDER_TOKEN");
  state.listError = false; state.empty = true; await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(page.getByText("Nenhum retorno disponível", { exact: true })).toBeVisible(); expect(state.posts).toHaveLength(0);
});

test("staff and unauthenticated sessions never read seller return journals", async ({ page }) => {
  const staff = await mockApi(page, { role: "staff" }); await page.goto("/#marketplace-asaas-wallet-returns");
  await expect(page.getByRole("dialog")).toBeVisible(); expect(staff.requests.filter(request => request.path.startsWith(root))).toHaveLength(0);
  await page.unrouteAll(); const anonymous = await mockApi(page, { noAuth: true }); await page.goto("/?mode=login#marketplace-asaas-wallet-returns");
  await expect(page.locator('input[type="password"]').first()).toBeVisible(); expect(anonymous.requests.filter(request => request.path.startsWith(root))).toHaveLength(0);
});

test("foreign financial receipt cannot render or enable a second execution", async ({ page }) => {
  const state = await mockApi(page, { wrongReceipt: true }); await page.goto("/#marketplace-asaas-wallet-returns");
  await review(page); await approve(page); await execute(page);
  await expect(page.getByRole("alert")).toContainText("esta solicitação não será reenviada");
  await expect(page.locator("body")).not.toContainText("foreign_payout");
  await expect(page.getByRole("button", { name: "Confirmar envio do retorno" })).toHaveCount(0); expect(state.posts).toHaveLength(2);
});
