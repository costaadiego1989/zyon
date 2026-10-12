import { test, expect, type Page } from "@playwright/test";

// Synthetic browser acceptance only. Native PSP responses and the merchant
// shell are intercepted; no test submits to Stripe or any external service.
const root = "/marketplace/dashboard/seller-fee-collections";
const debt = "debt_aurora";
type Status = "approved" | "creating" | "open" | "paid" | "credited" | "expired" | "unproven";
type Journal = {
  id: string; status: Status; gross: number; maximum: number;
  credit: number; processingFee: number; excess: number;
  returned?: number; excessStatus?: "held" | "unknown" | "pending" | "returned" | "failed";
};
type Options = {
  role?: string; noAuth?: boolean; initial?: Status; customerMissing?: boolean;
  lostApproval?: boolean; lostCreation?: boolean; unsafeUrl?: boolean; invalidDto?: boolean;
  blockedSubscription?: boolean;
  zeroFee?: boolean; lostClose?: boolean;
  dueCents?: number;
  lostExcessReturn?: boolean;
  newCollectionsBlocked?: boolean;
};

async function mockApi(page: Page, options: Options = {}) {
  const due = options.zeroFee ? 0 : options.dueCents ?? 270;
  const state = {
    merchant: "seller-a", noAuth: options.noAuth === true, role: options.role ?? "owner",
    id: "fee_collection_aurora", journals: [] as Journal[], collected: 0, fee: 0, excess: 0,
    listError: false, empty: false, invalidDto: options.invalidDto === true, obligationClosed: false,
    nextObservation: "paid" as "paid" | "credited", approvalUnavailable: false,
    nextExcessObservation: "returned" as "unknown" | "pending" | "returned" | "failed",
    posts: [] as Array<{ path: string; body: Record<string, unknown> }>,
    requests: [] as Array<{ path: string; method: string }>,
    deniedExternal: [] as string[],
  };
  if (options.initial) {
    const credited = options.initial === "credited";
    state.journals.push({ id: state.id, status: options.initial, gross: 300, maximum: 270,
      credit: credited ? 270 : 0, processingFee: credited ? 30 : 0, excess: 0 });
    if (credited) { state.collected = 270; state.fee = 30; }
  }
  const active = () => state.journals.at(-1);
  function candidate(older = false) {
    const unresolved = !older && state.journals.some(j => !["credited", "expired"].includes(j.status));
    const collected = older ? 0 : state.collected, excess = older ? 0 : state.excess;
    const closed = !older && state.obligationClosed;
    return {
      kind: "candidate", debt_id: older ? "debt_older" : debt,
      fee_certificate_id: options.zeroFee ? `mdebt_extinction_${(older ? "b" : "a").repeat(64)}` : older ? "cert_older" : "cert_aurora", environment: "test",
      due_cents: state.invalidDto ? 2.7 : due, collected_cents: collected, outstanding_cents: due - collected,
      processing_fee_cents: older ? 0 : state.fee, excess_liability_cents: excess,
      can_prepare: !options.newCollectionsBlocked && !options.customerMissing && !unresolved && collected < due && !closed,
      customer_setup_required: options.customerMissing === true && !options.zeroFee,
      obligation_status: closed ? "closed" : collected === due && excess > 0 ? "fees_collected_excess_held" : "outstanding",
      ...(closed ? { obligation_id: options.zeroFee ? `mseller_obligation_${"c".repeat(64)}` : "obligation_aurora" } : {}),
      obligation_can_close: !closed && collected === due && excess === 0,
      funding_hold_released: false, payout_reauthorized: false,
    };
  }
  function journal(j: Journal) {
    return {
      collection_id: j.id, debt_id: debt, fee_certificate_id: "cert_aurora", environment: "test", status: j.status,
      gross_amount_cents: j.gross, maximum_credit_cents: j.maximum, credited_net_cents: j.credit,
      processing_fee_cents: j.processingFee, processing_fee_known: j.status === "credited",
      excess_liability_cents: j.excess, ...(j.excess > 0 ? { excess_status: j.excessStatus ?? "held",
        returned_excess_cents: j.returned ?? 0, outstanding_excess_cents: j.excess - (j.returned ?? 0),
        can_return_excess: j.status === "credited" && (j.excessStatus ?? "held") === "held" } : {}),
      ...(j.status === "open" ? { checkout_url: options.unsafeUrl
        ? "https://checkout.stripe.com.evil.invalid/c/pay/cs_test_fixture"
        : "https://checkout.stripe.com/c/pay/cs_test_fixture" } : {}),
      request_hash: (j.id.endsWith("older") ? "b" : "a").repeat(64),
      can_execute: !options.newCollectionsBlocked && j.status === "approved" && j.gross >= 50, can_cancel: j.status === "approved", currency: "BRL",
      funding_hold_released: false, payout_reauthorized: false,
    };
  }

  await page.context().route(/.*/, async route => {
    const url = new URL(route.request().url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "localhost" && url.port === "5198")
      return route.continue();
    state.deniedExternal.push(`${url.protocol}//${url.host}`);
    return route.abort("blockedbyclient");
  });
  await page.context().routeWebSocket(/.*/, socket => {
    const url = new URL(socket.url());
    if (url.hostname === "localhost" && url.port === "5198") {
      socket.connectToServer();
      return;
    }
    state.deniedExternal.push(`${url.protocol}//${url.host}`);
    socket.close({ code: 1008, reason: "synthetic browser accepts local traffic only" });
  });
  await page.context().route("**/audit-api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/audit-api/v1", "");
    if (url.hostname !== "localhost" || url.port !== "5198") return route.abort("blockedbyclient");
    state.requests.push({ path, method: request.method() });
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/merchants/me") return state.noAuth ? json({}, 401)
      : json({ id: state.merchant, name: state.merchant === "seller-a" ? "Loja Aurora" : "Loja Horizonte",
        user_id: "owner-fixture", role: state.role, plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: "starter", status: "canceled",
      trial_expired: options.blockedSubscription === true, features: {} });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [
      { id: "seller-a", name: "Loja Aurora", role: state.role },
      { id: "seller-b", name: "Loja Horizonte", role: state.role },
    ] });
    if (path === "/merchants/me/stores/seller-b/activate") { state.merchant = "seller-b"; return json({ merchant_id: "seller-b" }); }
    if (path.startsWith(root) && (state.noAuth || !["owner", "admin"].includes(state.role))) return json({}, state.noAuth ? 401 : 403);
    if (path.startsWith(root) && state.merchant !== "seller-a") return path === `${root}/candidates` ? json({ items: [] }) : json({}, 404);
    if (path === `${root}/candidates`) {
      if (state.listError) return json({ message: "PRIVATE_PROVIDER_TOKEN" }, 503);
      return json({ items: state.empty ? [] : [candidate(url.searchParams.has("cursor"))],
        ...(state.empty || url.searchParams.has("cursor") ? {} : { next_cursor: "candidate_older" }) });
    }
    if (path.startsWith(`${root}/hosted-context/`)) return json(candidate(path.endsWith("debt_older")));
    if (path === root && request.method() === "GET") {
      if (url.searchParams.get("debt_id") !== debt) return json({ items: [] });
      return json({ items: [...state.journals].reverse().map(journal) });
    }
    if (path === `${root}/hosted` && request.method() === "POST") {
      const body = request.postDataJSON(); state.posts.push({ path, body }); state.id = body.collection_id;
      const j: Journal = { id: state.id, status: "approved", gross: body.gross_amount_cents,
        maximum: due - state.collected, credit: 0, processingFee: 0, excess: 0 };
      state.journals.push(j);
      return options.lostApproval ? route.abort("connectionreset") : json(journal(j));
    }
    const j = state.journals.find(value => path === `${root}/${value.id}` || path.startsWith(`${root}/${value.id}/`));
    if (j && request.method() === "GET") return state.approvalUnavailable ? json({}, 404) : json(journal(j));
    if (j && path.endsWith("/excess/return")) {
      const body = request.postDataJSON(); state.posts.push({ path, body });
      if (body.amount_cents !== j.excess || body.confirmed !== true || j.excessStatus && j.excessStatus !== "held") return json({}, 409);
      j.excessStatus = options.lostExcessReturn ? "unknown" : "pending";
      return options.lostExcessReturn ? route.abort("connectionreset") : json(journal(j));
    }
    if (j && path.endsWith("/execute")) {
      state.posts.push({ path, body: request.postDataJSON() });
      if (options.lostCreation) { j.status = "creating"; return route.abort("connectionreset"); }
      j.status = "open"; return json(journal(j));
    }
    if (j && path.endsWith("/cancel")) {
      state.posts.push({ path, body: request.postDataJSON() }); j.status = "expired"; return json(journal(j));
    }
    if (j && path.endsWith("/reconcile")) {
      state.posts.push({ path, body: request.postDataJSON() });
      if (j.status === "credited" && j.excess > 0 && j.excessStatus && j.excessStatus !== "held") {
        j.excessStatus = state.nextExcessObservation;
        if (j.excessStatus === "returned" && !j.returned) {
          j.returned = j.excess; state.excess -= j.excess;
          if (state.collected === due && state.excess === 0) state.obligationClosed = true;
        }
        return json(journal(j));
      }
      if (state.nextObservation === "paid") j.status = "paid";
      else if (j.status !== "credited") {
        j.status = "credited"; j.processingFee = 30; const net = j.gross - j.processingFee;
        j.credit = Math.min(net, j.maximum); j.excess = Math.max(net - j.maximum, 0);
        state.collected += j.credit; state.fee += j.processingFee; state.excess += j.excess;
      }
      return json(journal(j));
    }
    if (path === `${root}/obligations/${debt}/close`) {
      state.posts.push({ path, body: request.postDataJSON() });
      if (state.collected !== due || state.excess !== 0) return json({}, 409);
      state.obligationClosed = true;
      if (options.lostClose) { options.lostClose = false; return route.abort("failed"); }
      return json({ status: "closed", obligationId: options.zeroFee ? `mseller_obligation_${"c".repeat(64)}` : "obligation_aurora", debtId: debt, replay: false,
        fundingHoldReleased: false, payoutReauthorized: false });
    }
    if (path.startsWith(root)) return json({}, 404);
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  return { state, active };
}

const detail = (page: Page) => page.getByTestId("seller-fee-detail");
async function review(page: Page, debtId = debt) {
  await page.getByTestId(`seller-fee-candidate-${debtId}`).getByRole("button").click();
  await expect(detail(page)).toBeVisible();
}
async function prepare(page: Page, amount = "3,00") {
  await page.getByTestId("seller-fee-amount").fill(amount);
  await page.getByTestId("seller-fee-consent").check();
  await page.getByTestId("seller-fee-prepare").click();
}
async function execute(page: Page) {
  await page.getByTestId("seller-fee-execute-consent").check();
  await page.getByTestId("seller-fee-execute").click();
}
async function refreshAndReview(page: Page) {
  await page.getByRole("button", { name: "Atualizar lista", exact: true }).click(); await review(page);
}
async function switchMerchant(page: Page) {
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
}
function financialPosts(state: Awaited<ReturnType<typeof mockApi>>["state"], suffix: string) {
  return state.posts.filter(value => value.path.endsWith(suffix));
}

test("zero allocated fee closes only after explicit consent without a customer or Checkout", async ({ page }, info) => {
  const { state } = await mockApi(page, { zeroFee: true, customerMissing: true });
  await page.goto("/#marketplace-fees"); await review(page);
  await expect(detail(page)).toContainText("A parcela de taxa atribuída a esta loja é zero");
  await expect(detail(page)).toContainText("sem pagamento");
  await expect(detail(page)).not.toContainText("Conclua a configuração de cobrança");
  await expect(page.getByTestId("seller-fee-prepare")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-checkout")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-obligation-close")).toBeDisabled();
  expect(state.posts).toHaveLength(0);
  const consent = page.getByTestId("seller-fee-obligation-close-consent");
  await consent.focus(); await page.keyboard.press("Space"); await expect(consent).toBeChecked();
  await page.screenshot({ path: info.outputPath("zero-fee-explicit-consent.png"), fullPage: true });
  await page.getByTestId("seller-fee-obligation-close").click();
  await expect(detail(page)).toContainText("Obrigação individual quitada");
  expect(state.posts).toEqual([{ path: `${root}/obligations/${debt}/close`, body: { confirmed: true } }]);
  await page.reload(); await review(page); await expect(detail(page)).toContainText("Obrigação individual quitada");
  await expect(page.getByTestId("seller-fee-obligation-close")).toHaveCount(0);
  expect(state.posts).toHaveLength(1); expect(state.journals).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.deniedExternal.every(url => url === "https://fonts.googleapis.com")).toBe(true);
});

test("lost zero-fee closure response is recovered by state consultation without another command", async ({ page }) => {
  const { state } = await mockApi(page, { zeroFee: true, lostClose: true });
  await page.goto("/#marketplace-fees"); await review(page);
  await page.getByTestId("seller-fee-obligation-close-consent").check();
  await page.getByTestId("seller-fee-obligation-close").click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível confirmar a quitação individual");
  expect(state.posts).toHaveLength(1);
  const start = state.requests.length;
  await page.getByTestId("seller-fee-consult-state").click();
  await expect(detail(page)).toContainText("Obrigação individual quitada");
  expect(state.requests.slice(start).every(r => r.method === "GET")).toBe(true);
  expect(state.posts).toHaveLength(1); expect(state.journals).toHaveLength(0);
  await expect(page.getByTestId("seller-fee-obligation-close")).toHaveCount(0);
  expect(state.deniedExternal.every(url => url === "https://fonts.googleapis.com")).toBe(true);
});

test("seller gross requires 50 cents before consent and any financial submission", async ({ page }) => {
  const { state } = await mockApi(page, { dueCents: 31 });
  await page.goto("/#marketplace-fees"); await review(page);
  const amount = page.getByTestId("seller-fee-amount"), consent = page.getByTestId("seller-fee-consent"), register = page.getByTestId("seller-fee-prepare");
  await expect(amount).toHaveValue("0,50");
  await expect(amount).toHaveAttribute("min", "0.50");
  await expect(detail(page)).toContainText("O valor mínimo para este pagamento é R$ 0,50");
  await consent.check(); await expect(register).toBeEnabled();
  await amount.fill("0.49");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(consent).not.toBeChecked(); await expect(consent).toBeDisabled(); await expect(register).toBeDisabled();
  await expect(detail(page)).toContainText("Informe um valor de pelo menos R$ 0,50");
  expect(state.posts).toHaveLength(0);
  await amount.fill("0.50");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await expect(consent).toBeEnabled(); await expect(consent).not.toBeChecked(); await expect(register).toBeDisabled();
  await consent.check(); await expect(register).toBeEnabled(); await register.click();
  await expect(page.getByTestId("seller-fee-execute")).toBeDisabled();
  expect(financialPosts(state, "/hosted")).toHaveLength(1);
  expect(financialPosts(state, "/hosted")[0].body).toEqual({ debt_id: debt, collection_id: state.id, gross_amount_cents: 50, confirmed: true });
  await execute(page); await expect(page.getByTestId("seller-fee-checkout")).toBeVisible();
  expect(financialPosts(state, "/execute")).toEqual([{ path: `${root}/${state.id}/execute`, body: { gross_amount_cents: 50, confirmed: true } }]);
});

test("a persisted 31-cent seller approval remains visible and cancelable before fresh minimum consent", async ({ page }) => {
  const { state } = await mockApi(page, { dueCents: 31 });
  const legacyId = state.id;
  state.journals.push({ id: legacyId, status: "approved", gross: 31, maximum: 31, credit: 0, processingFee: 0, excess: 0 });
  const approvalKey = `zyon:seller-fee-collection:v1:seller-a:owner-fixture:approval:${debt}`;
  const approval = { id: legacyId, grossCents: 31, feeCertificateId: "cert_aurora", environment: "test" };
  await page.goto("/#marketplace-fees");
  await expect(page.getByTestId("seller-fees-page")).toBeVisible();
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: approvalKey, value: approval });
  await page.reload(); await review(page);
  await expect(detail(page)).toContainText("Autorização registrada");
  await expect(page.getByTestId(`seller-fee-journal-${legacyId}`)).toContainText("R$ 0,31");
  await expect(detail(page)).toContainText("Esta autorização está abaixo do mínimo de R$ 0,50");
  await expect(page.getByTestId("seller-fee-execute")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-execute-consent")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-prepare")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-cancel")).toBeDisabled();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), approvalKey)).toEqual(approval);
  const before = state.requests.length;
  await page.getByTestId("seller-fee-consult-approval").click();
  expect(state.requests.slice(before).filter(value => value.path.startsWith(root)).every(value => value.method === "GET")).toBe(true);
  expect(state.posts).toHaveLength(0);
  await page.getByTestId("seller-fee-cancel-consent").check(); await page.getByTestId("seller-fee-cancel").click();
  await expect(detail(page)).toContainText("Autorização encerrada");
  expect(await page.evaluate(key => localStorage.getItem(key), approvalKey)).toBeNull();
  expect(financialPosts(state, "/cancel")).toEqual([{ path: `${root}/${legacyId}/cancel`, body: { confirmed: true } }]);
  expect(financialPosts(state, "/execute")).toHaveLength(0);
  await expect(page.getByTestId("seller-fee-amount")).toHaveValue("0,50");
  await expect(page.getByTestId("seller-fee-consent")).not.toBeChecked(); await expect(page.getByTestId("seller-fee-prepare")).toBeDisabled();
  await prepare(page, "0,50");
  await expect(page.getByTestId("seller-fee-execute")).toBeDisabled();
  expect(state.id).not.toBe(legacyId); expect(financialPosts(state, "/hosted")).toHaveLength(1);
  expect(financialPosts(state, "/hosted")[0].body.gross_amount_cents).toBe(50);
  expect(financialPosts(state, "/execute")).toHaveLength(0);
});

test("explicit gross consent and one Checkout submission distinguish paid from certified net", async ({ page }, info) => {
  const { state } = await mockApi(page); await page.goto("/#marketplace-fees");
  await expect(page.getByTestId("seller-fees-page")).toBeVisible(); expect(state.posts).toHaveLength(0); await review(page);
  await expect(page.getByTestId("seller-fee-prepare")).toBeDisabled(); await prepare(page);
  await expect(page.getByTestId("seller-fee-execute")).toBeDisabled();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].body).toEqual({ debt_id: debt, collection_id: state.id, gross_amount_cents: 300, confirmed: true });
  expect(state.id).toMatch(/^mcfee_[a-f0-9]{32}$/);
  await page.getByTestId("seller-fee-execute-consent").check();
  await page.screenshot({ path: info.outputPath("gross-and-explicit-checkout-consent.png"), fullPage: true });
  await page.getByTestId("seller-fee-execute").click();
  await expect(page.getByTestId("seller-fee-checkout")).toHaveAttribute("href", "https://checkout.stripe.com/c/pay/cs_test_fixture");
  await expect(page.getByTestId("seller-fee-checkout")).toHaveAttribute("target", "_blank");
  expect(financialPosts(state, "/execute")).toHaveLength(1);
  expect(financialPosts(state, "/execute")[0].body).toEqual({ gross_amount_cents: 300, confirmed: true });
  await page.getByTestId("seller-fee-reconcile").click(); await expect(detail(page)).toContainText("Pagamento em conciliação");
  await expect(detail(page)).toContainText("R$ 0,00");
  await expect(page.getByTestId("seller-fee-obligation-close")).toBeDisabled();
  state.nextObservation = "credited"; await page.getByTestId("seller-fee-reconcile").click();
  await expect(detail(page)).toContainText("Crédito líquido conciliado"); await expect(detail(page)).toContainText("R$ 0,30");
  expect(state.collected).toBe(270); expect(financialPosts(state, "/execute")).toHaveLength(1);
  expect(financialPosts(state, "/reconcile").every(value => JSON.stringify(value.body) === '{"confirmed":true}')).toBe(true);
  await expect(detail(page)).toContainText(/reten|retid|repasses/i);
  await expect(page.getByTestId("seller-fee-obligation-close")).toBeDisabled();
  await page.getByTestId("seller-fee-obligation-close-consent").check();
  await page.getByTestId("seller-fee-obligation-close").click();
  await expect(detail(page)).toContainText("Obrigação individual quitada");
  await expect(page.getByTestId("seller-fee-obligation-close")).toHaveCount(0);
  expect(financialPosts(state, "/close")).toHaveLength(1);
  expect(financialPosts(state, "/close")[0].body).toEqual({ confirmed: true });
  await expect(detail(page)).toContainText("não libera o saldo do pedido nem autoriza repasses");
  await page.screenshot({ path: info.outputPath("certified-net-original-holds-preserved.png"), fullPage: true });
});

test("lost creation and a stale approved GET cannot replay submission after reload", async ({ page }) => {
  const { state, active } = await mockApi(page, { lostCreation: true });
  await page.goto("/#marketplace-fees"); await review(page); await prepare(page); await execute(page);
  await expect(page.getByRole("alert")).toContainText(/não será reenviada/i);
  await page.getByTestId("seller-fee-consult-state").click();
  expect(financialPosts(state, "/execute")).toHaveLength(1);
  active()!.status = "approved"; await page.reload(); await review(page);
  await page.getByTestId(`seller-fee-journal-${state.id}`).getByRole("button").click();
  await expect(page.getByTestId("seller-fee-execute")).toHaveCount(0);
  const before = state.requests.length; await page.getByTestId("seller-fee-consult-state").click();
  expect(state.requests.slice(before).filter(value => value.path.startsWith(root)).every(value => value.method === "GET")).toBe(true);
  expect(financialPosts(state, "/execute")).toHaveLength(1);
});

test("lost approval preserves its identity and lookup never creates a second authorization", async ({ page }) => {
  const { state } = await mockApi(page, { lostApproval: true });
  await page.goto("/#marketplace-fees"); await review(page); await prepare(page);
  await expect(page.getByRole("alert")).toContainText(/não foi possível confirmar/i);
  const id = state.id; state.approvalUnavailable = true;
  await page.getByTestId("seller-fee-consult-approval").click(); await expect(page.getByTestId("seller-fee-prepare")).toHaveCount(0);
  await page.reload(); await review(page); const before = state.requests.length;
  state.approvalUnavailable = false; await page.getByTestId("seller-fee-consult-approval").click();
  await expect(page.getByTestId("seller-fee-execute")).toBeDisabled();
  expect(state.id).toBe(id); expect(financialPosts(state, "/hosted")).toHaveLength(1);
  expect(state.requests.slice(before).filter(value => value.path.startsWith(root)).every(value => value.method === "GET")).toBe(true);
});

test("return URL ignores success flags and performs only one owned GET before explicit reconciliation", async ({ page }) => {
  const { state } = await mockApi(page, { initial: "open", blockedSubscription: true });
  await page.goto("/?collection_id=fee_collection_aurora&paid=true&success=true#marketplace-fees");
  await expect(detail(page)).toBeVisible(); await expect(detail(page)).toContainText("Checkout disponível");
  expect(state.posts).toHaveLength(0);
  expect(state.requests.filter(value => value.path.startsWith(root)).every(value => value.method === "GET")).toBe(true);
  expect(new URL(page.url()).searchParams.has("collection_id")).toBe(false);
  const lookups = state.requests.filter(value => value.path === `${root}/fee_collection_aurora`).length;
  expect(lookups).toBe(1);
  // Subscription remediation has no merchant selector. A subsequent bootstrap
  // for another merchant must not replay the already consumed return identity.
  state.merchant = "seller-b"; await page.reload();
  await expect(page.getByText("Nenhuma taxa disponível", { exact: true })).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
  expect(state.requests.filter(value => value.path === `${root}/fee_collection_aurora`)).toHaveLength(lookups);
  expect(state.posts).toHaveLength(0);
});

test("canceling an unsubmitted approval permits a new explicit consent without a Checkout", async ({ page }) => {
  const { state } = await mockApi(page); await page.goto("/#marketplace-fees"); await review(page); await prepare(page);
  await expect(page.getByTestId("seller-fee-cancel")).toBeDisabled(); const first = state.id;
  await page.getByRole("checkbox", { name: /Quero encerrar esta autorização/ }).check(); await page.getByTestId("seller-fee-cancel").click();
  await expect(detail(page)).toContainText("Autorização encerrada");
  expect(financialPosts(state, "/execute")).toHaveLength(0); expect(financialPosts(state, "/cancel")[0].body).toEqual({ confirmed: true });
  await refreshAndReview(page); await prepare(page);
  await expect(page.getByTestId("seller-fee-execute")).toBeDisabled();
  expect(state.id).not.toBe(first); expect(financialPosts(state, "/hosted")).toHaveLength(2);
});

test("a partial certified credit keeps the outstanding amount and requires new consent for another collection", async ({ page }) => {
  const { state } = await mockApi(page); state.nextObservation = "credited";
  await page.goto("/#marketplace-fees"); await review(page); await prepare(page, "1,30"); await execute(page);
  await page.getByTestId("seller-fee-reconcile").click(); await expect(detail(page)).toContainText("Crédito líquido conciliado");
  expect(state.collected).toBe(100); expect(state.excess).toBe(0); await refreshAndReview(page);
  await expect(detail(page)).toContainText("R$ 1,70"); await expect(page.getByTestId("seller-fee-consent")).not.toBeChecked();
  await expect(page.getByTestId("seller-fee-prepare")).toBeDisabled(); const first = state.id;
  await prepare(page, "2,00"); await execute(page); await page.getByTestId("seller-fee-reconcile").click();
  await expect(detail(page)).toContainText("Crédito líquido conciliado"); expect(state.collected).toBe(270); expect(state.id).not.toBe(first);
  expect(financialPosts(state, "/hosted")).toHaveLength(2); expect(financialPosts(state, "/execute")).toHaveLength(2);
});

test("certified excess stays held before explicit return consent and cannot authorize terminal closure", async ({ page }) => {
  const { state } = await mockApi(page); state.nextObservation = "credited";
  await page.goto("/#marketplace-fees"); await review(page); await prepare(page, "5,00"); await execute(page);
  await page.getByTestId("seller-fee-reconcile").click(); await expect(detail(page)).toContainText("Crédito líquido conciliado");
  expect(state.collected).toBe(270); expect(state.excess).toBe(200); await refreshAndReview(page);
  await expect(detail(page)).toContainText("R$ 2,00"); await expect(detail(page)).toContainText(/excedente/i);
  await expect(page.getByTestId("seller-fee-obligation-close")).toBeDisabled();
  expect(state.posts.some(value => /close|refund|excess\/return/.test(value.path))).toBe(false);
  expect(state.obligationClosed).toBe(false);
});

test("seller excess requires exact refund consent and stays due until certified reconciliation", async ({ page }, info) => {
  const { state } = await mockApi(page); state.nextObservation = "credited";
  await page.goto("/#marketplace-fees"); await review(page); await prepare(page, "5,00"); await execute(page);
  await page.getByTestId("seller-fee-reconcile").click(); await expect(page.getByTestId("seller-fee-excess-return")).toBeDisabled();
  await expect(detail(page)).toContainText("Excedente original desta cobrança"); await expect(detail(page)).toContainText("Excedente ainda devido");
  const consent = page.getByTestId("seller-fee-excess-consent");
  await expect(consent.locator("..")).toContainText("Autorizo devolver R$ 2,00 ao cartão usado nesta cobrança.");
  await consent.focus(); await page.keyboard.press("Space"); await expect(consent).toBeChecked();
  await page.screenshot({ path: info.outputPath("seller-excess-exact-consent.png"), fullPage: true });
  await page.getByTestId("seller-fee-excess-return").evaluate(button => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true })); button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(detail(page)).toContainText("Devolução do excedente em verificação");
  expect(financialPosts(state, "/excess/return")).toEqual([{ path: `${root}/${state.id}/excess/return`, body: { amount_cents: 200, confirmed: true } }]);
  expect(state.excess).toBe(200); expect(state.obligationClosed).toBe(false);
  await expect(page.getByTestId("seller-fee-excess-return")).toHaveCount(0);
  await page.getByTestId("seller-fee-reconcile").click(); await expect(detail(page)).toContainText("Devolução do excedente confirmada");
  await expect(detail(page)).toContainText("Obrigação individual quitada");
  expect(state.excess).toBe(0); expect(state.journals[0].excess).toBe(200); expect(state.journals[0].returned).toBe(200);
  expect(financialPosts(state, "/excess/return")).toHaveLength(1); expect(financialPosts(state, "/close")).toHaveLength(0);
  await expect(detail(page)).toContainText("não libera o saldo do pedido nem autoriza repasses");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("seller-excess-certified-terminal.png"), fullPage: true });
});

test("lost seller excess response and a stale held GET cannot replay after reload", async ({ page }) => {
  const { state, active } = await mockApi(page, { lostExcessReturn: true }); state.nextObservation = "credited";
  await page.goto("/#marketplace-fees"); await review(page); await prepare(page, "5,00"); await execute(page);
  await page.getByTestId("seller-fee-reconcile").click(); await page.getByTestId("seller-fee-excess-consent").check();
  await page.getByTestId("seller-fee-excess-return").click(); await expect(page.getByRole("alert")).toContainText("esta solicitação não será reenviada");
  active()!.excessStatus = "held"; await page.reload(); await review(page);
  await page.getByTestId(`seller-fee-journal-${state.id}`).getByRole("button").click();
  await expect(page.getByTestId("seller-fee-excess-return")).toHaveCount(0);
  await expect(detail(page)).toContainText("Uma devolução do excedente já foi solicitada neste navegador");
  const before = state.requests.length; await page.getByTestId("seller-fee-consult-state").click();
  await expect.poll(() => state.requests.slice(before).filter(value => value.path === `${root}/${state.id}` && value.method === "GET").length).toBe(1);
  expect(state.requests.slice(before).filter(value => value.path.startsWith(root)).every(value => value.method === "GET")).toBe(true);
  expect(financialPosts(state, "/excess/return")).toHaveLength(1);
  active()!.excessStatus = "unknown"; await page.getByTestId("seller-fee-reconcile").click();
  await expect(detail(page)).toContainText("Devolução do excedente confirmada");
  expect(financialPosts(state, "/excess/return")).toHaveLength(1);
});

test("changing merchants discards seller excess consent before any refund command", async ({ page }) => {
  const { state } = await mockApi(page); state.nextObservation = "credited";
  await page.goto("/#marketplace-fees"); await review(page); await prepare(page, "5,00"); await execute(page);
  await page.getByTestId("seller-fee-reconcile").click(); await page.getByTestId("seller-fee-excess-consent").check();
  await switchMerchant(page); await expect(detail(page)).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-excess-consent")).toHaveCount(0); expect(financialPosts(state, "/excess/return")).toHaveLength(0);
});

test("MVP capabilities keep seller history recoverable without new collections or Checkout", async ({ page }, info) => {
  const { state } = await mockApi(page, { initial: "approved", newCollectionsBlocked: true, customerMissing: true });
  const approvedId = state.id, paidId = `${approvedId}_older`;
  state.journals.push({ id: paidId, status: "paid", gross: 130, maximum: 270, credit: 0, processingFee: 0, excess: 0 });
  await page.goto("/#marketplace-fees");
  await expect(page).toHaveURL(/#marketplace-fees$/); await expect(page.getByTestId("seller-fees-page")).toBeVisible();
  const navigation = page.locator(".console-mobile-nav"); await expect(navigation).toHaveCount(1);
  await expect(navigation.locator('option[value="marketplace-fees"]')).toHaveCount(0);
  await expect(navigation.locator('option[value="marketplace-host-fees"]')).toHaveCount(0);
  await expect(page.getByTestId("seller-fees-page")).toContainText("Modo de recuperação"); await review(page);
  await expect(page.getByTestId("seller-fees-page")).not.toContainText("autorize o pagamento");
  await expect(detail(page)).not.toContainText("Conclua a configuração de cobrança");
  await expect(page.getByTestId("seller-fee-amount")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-prepare")).toHaveCount(0);
  await page.getByTestId(`seller-fee-journal-${approvedId}`).getByRole("button").click();
  await expect(detail(page)).toContainText("Autorização registrada"); await expect(detail(page)).toContainText("R$ 3,00");
  await expect(page.getByTestId("seller-fee-execute")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-execute-consent")).toHaveCount(0);
  await expect(page.getByTestId("seller-fee-checkout")).toHaveCount(0);
  const beforeLookup = state.requests.length; await page.getByTestId("seller-fee-consult-state").click();
  await expect.poll(() => state.requests.slice(beforeLookup).filter(value => value.path === `${root}/${approvedId}` && value.method === "GET").length).toBe(1);
  expect(state.posts).toHaveLength(0);
  await page.getByTestId(`seller-fee-journal-${paidId}`).getByRole("button").click();
  await expect(detail(page)).toContainText("Pagamento em conciliação"); state.nextObservation = "credited";
  await page.getByTestId("seller-fee-reconcile").click(); await expect(detail(page)).toContainText("Crédito líquido conciliado");
  expect(state.collected).toBe(100);
  expect(state.posts).toEqual([{ path: `${root}/${paidId}/reconcile`, body: { confirmed: true } }]);
  await expect(page.getByTestId(`seller-fee-journal-${approvedId}`)).toBeVisible();
  await expect(page.getByTestId("seller-fee-prepare")).toHaveCount(0); await expect(page.getByTestId("seller-fee-checkout")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("seller-mvp-history-recovery.png"), fullPage: true });
});

test("customer setup, candidate pagination, server errors and an empty list remain read-only", async ({ page }) => {
  const { state } = await mockApi(page, { customerMissing: true }); await page.goto("/#marketplace-fees"); await review(page);
  await expect(page.getByTestId("seller-fees-page")).toContainText("Modo de recuperação");
  await expect(detail(page)).not.toContainText("Conclua a configuração de cobrança"); await expect(page.getByTestId("seller-fee-prepare")).toHaveCount(0);
  await page.getByTestId("seller-fee-candidates-next").click(); await expect(page.getByTestId("seller-fee-candidate-debt_older")).toBeVisible();
  await page.getByTestId("seller-fee-candidates-previous").click(); await expect(page.getByTestId(`seller-fee-candidate-${debt}`)).toBeVisible();
  state.listError = true; await page.getByRole("button", { name: "Atualizar lista", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/não foi possível carregar/i); await expect(page.locator("body")).not.toContainText("PRIVATE_PROVIDER_TOKEN");
  state.listError = false; state.empty = true; await page.getByRole("button", { name: "Atualizar lista", exact: true }).click();
  await expect(page.getByTestId(`seller-fee-candidate-${debt}`)).toHaveCount(0); expect(state.posts).toHaveLength(0);
});

test("staff and an expired session cannot discover seller collections", async ({ page }) => {
  const staff = await mockApi(page, { role: "staff" }); await page.goto("/#marketplace-fees");
  await expect(page.getByTestId("seller-fees-page")).toHaveCount(0); await expect(page.getByRole("dialog")).toBeVisible();
  expect(staff.state.requests.filter(value => value.path.startsWith(root))).toHaveLength(0); await page.context().unrouteAll();
  const expired = await mockApi(page, { noAuth: true }); await page.goto("/?mode=login#marketplace-fees");
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  expect(expired.state.requests.filter(value => value.path.startsWith(root))).toHaveLength(0);
});

test("unsafe Checkout links and invalid money DTOs fail closed without financial commands", async ({ page }) => {
  const unsafe = await mockApi(page, { initial: "open", unsafeUrl: true });
  await page.goto("/?collection_id=fee_collection_aurora#marketplace-fees");
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByTestId("seller-fee-checkout")).toHaveCount(0);
  expect(unsafe.state.posts).toHaveLength(0); await page.context().unrouteAll();
  const malformed = await mockApi(page, { invalidDto: true }); await page.goto("/#marketplace-fees");
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByTestId("seller-fee-prepare")).toHaveCount(0);
  expect(malformed.state.posts).toHaveLength(0);
});

test("changing merchants clears consent and detail before any financial submission", async ({ page }) => {
  const { state } = await mockApi(page); await page.goto("/#marketplace-fees"); await review(page);
  await page.getByTestId("seller-fee-amount").fill("10,00"); await page.getByTestId("seller-fee-consent").check();
  await switchMerchant(page); await expect(detail(page)).toHaveCount(0); await expect(page.getByTestId("seller-fee-consent")).toHaveCount(0);
  await expect(page.getByTestId(`seller-fee-candidate-${debt}`)).toHaveCount(0); expect(state.posts).toHaveLength(0);
});

test("durable-storage failure blocks POST while keyboard review and both color preferences remain usable", async ({ page }, info) => {
  await page.addInitScript(() => {
    const native = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("zyon:seller-fee-collection:")) throw Error("synthetic storage denied");
      native.call(this, key, value);
    };
  });
  const { state } = await mockApi(page); await page.emulateMedia({ colorScheme: "light" }); await page.goto("/#marketplace-fees");
  const reviewButton = page.getByTestId(`seller-fee-candidate-${debt}`).getByRole("button");
  await reviewButton.focus(); await page.keyboard.press("Enter"); await expect(detail(page).getByRole("heading").first()).toBeFocused();
  await prepare(page); await expect(page.getByText("Este navegador não permite preservar o controle dos envios.", { exact: false })).toBeVisible();
  expect(state.posts).toHaveLength(0); await page.getByTestId("seller-fee-consult-state").click(); expect(state.posts).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("storage-blocked-light-keyboard-mobile-safe.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("storage-blocked-dark-mobile-safe.png"), fullPage: true });
});
