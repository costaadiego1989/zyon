import { test, expect, type Page } from "@playwright/test";
const root = "/marketplace/dashboard/contribution-checkouts";
type Status = "approved" | "creating" | "open" | "paid" | "credited" | "expired";
async function mockApi(page: Page, options: { role?: string; noAuth?: boolean; lost?: boolean; lostApproval?: boolean; lostExcess?: boolean;
  initial?: Status; unsafeUrl?: boolean; blockedSubscription?: boolean; customerMissing?: boolean } = {}) {
  const state = { merchant: "seller-a", status: options.initial ?? null as Status | null, id: "contribution_aurora", gross: 500,
    listError: false, empty: false, excess: "held" as "held" | "unknown" | "returned", returned: 0,
    posts: [] as Array<{ path: string; body: Record<string, unknown> }>, requests: [] as Array<{ path: string; method: string }> };
  const role = options.role ?? "owner";
  function candidate(older = false) { return { kind: "candidate", refund_plan_id: older ? "refund_older" : "refund_aurora", environment: "test",
    required_net_cents: 99, outstanding_net_cents: 99, customer_setup_required: options.customerMissing === true, can_create: options.customerMissing !== true }; }
  function journal() { const credited = state.status === "credited" || state.status === "paid";
    return { kind: "journal", contribution_id: state.id, refund_plan_id: "refund_aurora", environment: "test", status: state.status,
      gross_amount_cents: state.gross, maximum_credit_cents: 99, credited_net_cents: credited ? 99 : 0, processing_fee_cents: credited ? 50 : 0,
      excess_liability_cents: credited ? state.gross - 149 : 0, returned_excess_cents: credited ? state.returned : 0,
      ...(credited ? { excess_status: state.excess } : {}), ...(state.status === "open" ? { checkout_url: options.unsafeUrl ? "https://evil.invalid/pay" : "https://checkout.stripe.com/c/pay/cs_test_fixture" } : {}),
      request_hash: "a".repeat(64), can_create: false, can_cancel: state.status === "approved", can_return_excess: state.status === "credited" && state.excess === "held",
      currency: "BRL", collection_mode: "hosted_checkout", processing_fee_known: credited };
  }
  await page.context().route("**/audit-api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/audit-api/v1", "");
    state.requests.push({ path, method: request.method() }); const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/merchants/me") return options.noAuth ? json({}, 401) : json({ id: state.merchant, name: state.merchant === "seller-a" ? "Loja Aurora" : "Loja Horizonte", user_id: "owner-fixture", role, plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: "starter", status: "canceled", trial_expired: options.blockedSubscription === true, features: {} });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "seller-a", name: "Loja Aurora", role }, { id: "seller-b", name: "Loja Horizonte", role }] });
    if (path === "/merchants/me/stores/seller-b/activate") { state.merchant = "seller-b"; return json({ merchant_id: "seller-b" }); }
    if (path === root && request.method() === "GET") {
      if (state.listError) return json({ message: "PRIVATE_PROVIDER_TOKEN" }, 503);
      return json({ items: state.empty || state.merchant === "seller-b" ? [] : url.searchParams.has("cursor") ? [candidate(true)] :
        state.status ? state.status === "expired" ? [journal(), candidate()] : [journal()] : [candidate()],
        ...(state.empty || state.merchant === "seller-b" || url.searchParams.has("cursor") ? {} : { next_cursor: "cursor_older" }) });
    }
    if (path === root && request.method() === "POST") {
      const body = request.postDataJSON(); state.posts.push({ path, body }); state.id = body.contribution_id; state.gross = body.gross_amount_cents; state.status = "approved";
      return options.lostApproval ? route.abort("connectionreset") : json(journal());
    }
    if (path.startsWith(`${root}/context/`)) return json(candidate(path.endsWith("refund_older")));
    if (path === `${root}/${state.id}/execute`) {
      state.posts.push({ path, body: request.postDataJSON() }); if (options.lost) return route.abort("connectionreset"); state.status = "open"; return json(journal());
    }
    if (path === `${root}/${state.id}/cancel`) { state.posts.push({ path, body: request.postDataJSON() }); state.status = "expired"; return json(journal()); }
    if (path === `${root}/${state.id}/return-excess`) {
      state.posts.push({ path, body: request.postDataJSON() }); if (options.lostExcess) return route.abort("connectionreset"); state.excess = "unknown"; return json(journal());
    }
    if (path === `${root}/${state.id}/reconcile`) {
      state.posts.push({ path, body: request.postDataJSON() }); state.status = "credited";
      if (state.excess === "unknown") { state.excess = "returned"; state.returned = state.gross - 149; } return json(journal());
    }
    if (path === `${root}/${state.id}`) return state.merchant === "seller-a" ? json(journal()) : json({}, 404);
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  await page.context().route(/^https?:\/\/(?!localhost:5197)/, route => route.abort());
  return state;
}
async function review(page: Page) { await page.getByRole("button", { name: "Revisar aporte", exact: true }).first().click(); }
async function prepare(page: Page, result: "approved" | "lost" | "storage" = "approved") {
  await page.getByRole("textbox", { name: "Valor bruto do aporte (R$)" }).fill("5,00");
  await page.getByRole("checkbox", { name: /Autorizo o valor bruto/ }).check();
  await page.getByRole("button", { name: "Registrar autorização do aporte" }).click();
  if (result === "approved") await expect(page.getByRole("button", { name: "Criar Checkout autorizado" })).toBeDisabled();
  else if (result === "lost") await expect(page.getByRole("alert")).toContainText("Não foi possível confirmar a autorização");
  else await expect(page.getByText("Este navegador não permite preservar o controle dos envios.", { exact: false })).toBeVisible();
}
async function execute(page: Page) {
  await page.getByRole("checkbox", { name: /Confirmo criar agora/ }).check(); await page.getByRole("button", { name: "Criar Checkout autorizado" }).click();
}
test("discovery, gross consent, explicit creation and verified net/excess remain separate", async ({ page }, info) => {
  const state = await mockApi(page); await page.goto("/#marketplace-contributions");
  await expect(page.getByRole("heading", { name: "Aportes para estornos", exact: true })).toBeVisible(); expect(state.posts).toHaveLength(0);
  await review(page); await expect(page.getByRole("heading", { name: "Revisar aporte para estorno" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Registrar autorização do aporte" })).toBeDisabled();
  await prepare(page); expect(state.posts).toHaveLength(1); expect(state.posts[0].body).toMatchObject({ refund_plan_id: "refund_aurora", gross_amount_cents: 500, confirmed: true });
  expect(String(state.posts[0].body.contribution_id)).toMatch(/^mc_[a-f0-9]{32}$/);
  await expect(page.getByRole("button", { name: "Criar Checkout autorizado" })).toBeDisabled();
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("A confirmar");
  await page.getByRole("checkbox", { name: /Confirmo criar agora/ }).check();
  await page.screenshot({ path: info.outputPath("explicit-contribution-confirmation.png"), fullPage: true });
  await page.getByRole("button", { name: "Criar Checkout autorizado" }).click();
  await expect(page.getByRole("link", { name: "Abrir Checkout do Stripe em nova aba" })).toHaveAttribute("href", "https://checkout.stripe.com/c/pay/cs_test_fixture");
  expect(state.posts.filter(v => v.path.endsWith("/execute"))).toHaveLength(1);
  await page.getByRole("button", { name: "Verificar pagamento" }).click();
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("Aporte conciliado");
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("R$ 0,50");
  await expect(page.getByRole("button", { name: "Devolver excedente autorizado" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /Autorizo devolver/ }).check(); await page.getByRole("button", { name: "Devolver excedente autorizado" }).click();
  await expect.poll(() => state.posts.filter(v => v.path.endsWith("/return-excess")).length).toBe(1);
  expect(state.posts.find(v => v.path.endsWith("/return-excess"))?.body).toEqual({ amount_cents: 351, confirmed: true });
  await page.getByRole("button", { name: "Verificar pagamento" }).click();
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("Devolução do excedente confirmada.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("contribution-excess-returned.png"), fullPage: true });
});
test("lost creation, stale approval and reload never replay Checkout while local cancellation remains viable", async ({ page }) => {
  const state = await mockApi(page, { lost: true }); await page.goto("/#marketplace-contributions"); await review(page); await prepare(page); await execute(page);
  await expect(page.getByRole("alert")).toContainText("esta solicitação não será reenviada");
  await page.getByRole("button", { name: "Consultar estado", exact: true }).click();
  await page.reload(); await review(page); await expect(page.getByRole("button", { name: "Criar Checkout autorizado" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancelar autorização" })).toBeDisabled();
  const before = state.requests.length; await page.getByRole("button", { name: "Consultar estado", exact: true }).click();
  expect(state.requests.slice(before).filter(v => v.path.startsWith(root)).every(v => v.method === "GET")).toBe(true);
  await page.getByRole("button", { name: "Verificar pagamento" }).click(); expect(state.posts.filter(v => v.path.endsWith("/execute"))).toHaveLength(1);
});
test("a submission marker with an unreceived POST permits only explicit local cancellation", async ({ page }) => {
  const state = await mockApi(page, { lost: true }); await page.goto("/#marketplace-contributions"); await review(page); await prepare(page); await execute(page);
  await expect(page.getByRole("alert")).toContainText("esta solicitação não será reenviada"); await page.reload(); await review(page);
  await expect(page.getByRole("button", { name: "Criar Checkout autorizado" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Quero encerrar esta autorização/ }).check(); await page.getByRole("button", { name: "Cancelar autorização" }).click();
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("Autorização encerrada");
  expect(state.posts.filter(v => v.path.endsWith("/execute"))).toHaveLength(1); expect(state.posts.filter(v => v.path.endsWith("/cancel"))).toHaveLength(1);
  const before = state.posts.length; await page.reload(); await page.getByTestId(`contribution-${state.id}`).getByRole("button").click();
  await expect(page.getByRole("button", { name: "Criar Checkout autorizado" })).toHaveCount(0); expect(state.posts).toHaveLength(before);
});
test("return URL reads own durable journal without payment POST or automatic PSP reconciliation", async ({ page }) => {
  const state = await mockApi(page, { initial: "open" }); await page.goto("/?contribution_id=contribution_aurora#marketplace-contributions");
  await expect(page.getByRole("heading", { name: "Revisar aporte para estorno" })).toBeVisible(); expect(state.posts).toHaveLength(0);
  expect(state.requests.filter(v => v.path.startsWith(root)).every(v => v.method === "GET")).toBe(true);
  expect(new URL(page.url()).searchParams.has("contribution_id")).toBe(false);
  await page.getByRole("button", { name: "Verificar pagamento" }).click(); await expect(page.locator(".marketplace-refunds__detail")).toContainText("Aporte conciliado"); expect(state.posts).toHaveLength(1);
  expect(state.posts[0].path).toContain("/reconcile"); expect(state.posts[0].body).toEqual({ confirmed: true });
  const lookups = state.requests.filter(v => v.path === `${root}/contribution_aurora`).length;
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
  await expect(page.getByText("Nenhum aporte disponível", { exact: true })).toBeVisible();
  expect(state.requests.filter(v => v.path === `${root}/contribution_aurora`).length).toBe(lookups);
  expect(state.posts).toHaveLength(1);
});
test("lost approval preserves generated identity and offers only GET lookup before creation", async ({ page }) => {
  const state = await mockApi(page, { lostApproval: true }); await page.goto("/#marketplace-contributions"); await review(page); await prepare(page, "lost");
  await expect(page.getByRole("button", { name: "Registrar autorização do aporte" })).toHaveCount(0);
  const before = state.requests.length; await page.getByRole("button", { name: "Consultar autorização" }).click();
  await expect(page.getByRole("button", { name: "Criar Checkout autorizado" })).toBeDisabled();
  expect(state.requests.slice(before).filter(v => v.path.startsWith(root)).every(v => v.method === "GET")).toBe(true); expect(state.posts).toHaveLength(1);
});
test("canceling an unsubmitted approval expires locally and allows a new human approval", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#marketplace-contributions"); await review(page); await prepare(page);
  await expect(page.getByRole("button", { name: "Cancelar autorização" })).toBeDisabled(); const first = state.id;
  await page.getByRole("checkbox", { name: /Quero encerrar esta autorização/ }).check(); await page.getByRole("button", { name: "Cancelar autorização" }).click();
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("Autorização encerrada");
  expect(state.posts.filter(v => v.path.endsWith("/execute"))).toHaveLength(0);
  await page.getByRole("button", { name: "Atualizar lista" }).click(); await page.getByTestId("contribution-refund_aurora").getByRole("button").click(); await prepare(page);
  expect(state.id).not.toBe(first); expect(state.posts.filter(v => v.path === root)).toHaveLength(2);
});
test("lost excess return remains observation-only after a stale held GET and reload", async ({ page }) => {
  const state = await mockApi(page, { initial: "credited", lostExcess: true }); await page.goto("/#marketplace-contributions"); await review(page);
  await page.getByRole("checkbox", { name: /Autorizo devolver/ }).check(); await page.getByRole("button", { name: "Devolver excedente autorizado" }).click();
  await expect(page.getByRole("alert")).toContainText("esta solicitação não será reenviada"); await page.reload(); await review(page);
  await expect(page.getByRole("button", { name: "Devolver excedente autorizado" })).toHaveCount(0);
  await page.getByRole("button", { name: "Verificar pagamento" }).click(); expect(state.posts.filter(v => v.path.endsWith("/return-excess"))).toHaveLength(1);
});
test("paid certified crash state shows actual money and held excess without a new payment or refund", async ({ page }) => {
  const state = await mockApi(page, { initial: "paid" }); await page.goto("/#marketplace-contributions"); await review(page);
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("Pagamento em conciliação");
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("R$ 0,50");
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("R$ 3,51");
  await expect(page.getByRole("button", { name: "Criar Checkout autorizado" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Devolver excedente autorizado" })).toHaveCount(0); expect(state.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Verificar pagamento" }).click(); await expect(page.locator(".marketplace-refunds__detail")).toContainText("Aporte conciliado"); expect(state.posts).toHaveLength(1);
});
test("tenant switch clears consent, detail and return-query ownership without foreign commands", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#marketplace-contributions"); await review(page);
  await page.getByRole("textbox", { name: "Valor bruto do aporte (R$)" }).fill("10,00"); await page.getByRole("checkbox", { name: /Autorizo o valor bruto/ }).check();
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
  await expect(page.getByText("Nenhum aporte disponível", { exact: true })).toBeVisible(); await expect(page.getByRole("checkbox")).toHaveCount(0); expect(state.posts).toHaveLength(0);
});
test("pagination, setup prerequisites, empty state and errors do not create a payment", async ({ page }) => {
  const state = await mockApi(page, { customerMissing: true }); await page.goto("/#marketplace-contributions"); await review(page);
  await expect(page.locator(".marketplace-refunds__detail")).toContainText("Conclua a configuração de cobrança"); await expect(page.getByRole("button", { name: "Registrar autorização do aporte" })).toHaveCount(0);
  await page.getByRole("button", { name: "Próxima", exact: true }).click(); await expect(page.getByText("refund_older", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Anterior", exact: true }).click(); state.listError = true;
  await page.getByRole("button", { name: "Atualizar lista" }).click(); await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.locator("body")).not.toContainText("PRIVATE_PROVIDER_TOKEN"); state.listError = false; state.empty = true;
  await page.getByRole("button", { name: "Atualizar lista" }).click(); await expect(page.getByText("Nenhum aporte disponível", { exact: true })).toBeVisible(); expect(state.posts).toHaveLength(0);
});
test("unsafe provider URL fails closed before payment links can render", async ({ page }) => {
  const state = await mockApi(page, { initial: "open", unsafeUrl: true }); await page.goto("/#marketplace-contributions");
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar"); await expect(page.getByRole("link", { name: /Abrir Checkout/ })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});
test("blocked subscription still permits owner financial remediation without automatic payment", async ({ page }) => {
  const state = await mockApi(page, { blockedSubscription: true, initial: "open" }); await page.goto("/?contribution_id=contribution_aurora#marketplace-contributions");
  await expect(page.getByRole("heading", { name: "Aportes para estornos", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Voltar à assinatura" })).toBeVisible(); expect(state.posts).toHaveLength(0);
});
test("staff and anonymous sessions cannot discover contribution journals", async ({ page }) => {
  const staff = await mockApi(page, { role: "staff" }); await page.goto("/#marketplace-contributions"); await expect(page.getByRole("dialog")).toBeVisible();
  expect(staff.requests.filter(v => v.path.startsWith(root))).toHaveLength(0); await page.context().unrouteAll();
  const anonymous = await mockApi(page, { noAuth: true }); await page.goto("/?mode=login#marketplace-contributions");
  await expect(page.locator('input[type="password"]').first()).toBeVisible(); expect(anonymous.requests.filter(v => v.path.startsWith(root))).toHaveLength(0);
});
test("unavailable durable storage blocks financial POST while leaving read access", async ({ page }) => {
  await page.addInitScript(() => { const native = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k.startsWith("zyon:contribution-checkout:")) throw Error("storage blocked"); native.call(this, k, v); }; });
  const state = await mockApi(page); await page.goto("/#marketplace-contributions"); await review(page); await prepare(page, "storage");
  await expect(page.getByText("Este navegador não permite preservar o controle dos envios.", { exact: false })).toBeVisible(); expect(state.posts).toHaveLength(0);
  await page.getByRole("button", { name: "Consultar estado", exact: true }).click(); expect(state.posts).toHaveLength(0);
});
