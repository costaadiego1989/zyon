import { test, expect, type Page } from "@playwright/test";

// Synthetic browser acceptance only. Native PSP responses and the merchant
// shell are intercepted; no test submits to Stripe or any external service.
const root = "/marketplace/dashboard/host-fee-collections";
const debt = "host_payout_aurora";
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
  lostExcessReturn?: boolean;
  newCollectionsBlocked?: boolean;
};

async function mockApi(page: Page, options: Options = {}) {
  const state = {
    merchant: "host-a", noAuth: options.noAuth === true, role: options.role ?? "owner",
    id: "host_fee_collection_aurora", journals: [] as Journal[], collected: 0, fee: 0, excess: 0,
    listError: false, empty: false, invalidDto: options.invalidDto === true, obligationClosed: false,
    nextObservation: "paid" as "paid" | "credited", nextProcessingFee: 30, approvalUnavailable: false,
    nextExcessObservation: "returned" as "unknown" | "pending" | "returned" | "failed",
    posts: [] as Array<{ path: string; body: Record<string, unknown> }>,
    requests: [] as Array<{ path: string; method: string }>,
    deniedExternal: [] as string[],
  };
  if (options.initial) {
    const credited = options.initial === "credited";
    state.journals.push({ id: state.id, status: options.initial, gross: 60, maximum: 30,
      credit: credited ? 30 : 0, processingFee: credited ? 30 : 0, excess: 0 });
    if (credited) { state.collected = 30; state.fee = 30; }
  }
  const active = () => state.journals.at(-1);
  function candidate(older = false) {
    const unresolved = !older && state.journals.some(j => !["credited", "expired"].includes(j.status));
    const collected = older ? 0 : state.collected, excess = older ? 0 : state.excess;
    const closed = !older && state.obligationClosed;
    return {
      kind: "candidate", debt_id: older ? "host_payout_older" : debt,
      fee_certificate_id: older ? "mhost_extinction_" + "c".repeat(64) : "mhost_extinction_" + "a".repeat(64), environment: "test",
      due_cents: state.invalidDto ? 2.7 : 30, collected_cents: collected, outstanding_cents: 30 - collected,
      processing_fee_cents: older ? 0 : state.fee, excess_liability_cents: excess,
      can_prepare: !options.newCollectionsBlocked && !options.customerMissing && !unresolved && collected < 30 && !closed,
      customer_setup_required: options.customerMissing === true,
      obligation_status: closed ? "closed" : collected === 30 && excess > 0 ? "fees_collected_excess_held" : "outstanding",
      ...(closed ? { obligation_id: "mhost_obligation_" + "b".repeat(64) } : {}),
      obligation_can_close: !closed && collected === 30 && excess === 0,
      funding_hold_released: false, payout_reauthorized: false,
    };
  }
  function journal(j: Journal) {
    return {
      collection_id: j.id, debt_id: debt, fee_certificate_id: "mhost_extinction_" + "a".repeat(64), environment: "test", status: j.status,
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
      : json({ id: state.merchant, name: state.merchant === "host-a" ? "Loja Aurora" : "Loja Horizonte",
        user_id: "owner-fixture", role: state.role, plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: "starter", status: "canceled",
      trial_expired: options.blockedSubscription === true, features: {} });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [
      { id: "host-a", name: "Loja Aurora", role: state.role },
      { id: "host-b", name: "Loja Horizonte", role: state.role },
    ] });
    if (path === "/merchants/me/stores/host-b/activate") { state.merchant = "host-b"; return json({ merchant_id: "host-b" }); }
    if (path.startsWith(root) && (state.noAuth || !["owner", "admin"].includes(state.role))) return json({}, state.noAuth ? 401 : 403);
    if (path.startsWith(root) && state.merchant !== "host-a") return path === `${root}/candidates` ? json({ items: [] }) : json({}, 404);
    if (path === `${root}/candidates`) {
      if (state.listError) return json({ message: "PRIVATE_PROVIDER_TOKEN" }, 503);
      return json({ items: state.empty ? [] : [candidate(url.searchParams.has("cursor"))],
        ...(state.empty || url.searchParams.has("cursor") ? {} : { next_cursor: "candidate_older" }) });
    }
    if (path.startsWith(`${root}/hosted-context/`)) return json(candidate(path.endsWith("host_payout_older")));
    if (path === root && request.method() === "GET") {
      if (url.searchParams.get("debt_id") !== debt) return json({ items: [] });
      return json({ items: [...state.journals].reverse().map(journal) });
    }
    if (path === `${root}/hosted` && request.method() === "POST") {
      const body = request.postDataJSON(); state.posts.push({ path, body }); state.id = body.collection_id;
      const j: Journal = { id: state.id, status: "approved", gross: body.gross_amount_cents,
        maximum: 30 - state.collected, credit: 0, processingFee: 0, excess: 0 };
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
          if (state.collected === 30 && state.excess === 0) state.obligationClosed = true;
        }
        return json(journal(j));
      }
      if (state.nextObservation === "paid") j.status = "paid";
      else if (j.status !== "credited") {
        j.status = "credited"; j.processingFee = state.nextProcessingFee; const net = j.gross - j.processingFee;
        j.credit = Math.min(net, j.maximum); j.excess = Math.max(net - j.maximum, 0);
        state.collected += j.credit; state.fee += j.processingFee; state.excess += j.excess;
        if (state.collected === 30 && state.excess === 0) state.obligationClosed = true;
      }
      return json(journal(j));
    }
    if (path === `${root}/obligations/${debt}/close`) {
      state.posts.push({ path, body: request.postDataJSON() });
      if (state.collected !== 30 || state.excess !== 0) return json({}, 409);
      state.obligationClosed = true;
      return json({ status: "closed", obligationId: "mhost_obligation_" + "b".repeat(64), debtId: debt, replay: false,
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

const detail = (page: Page) => page.getByTestId("host-fee-detail");
async function review(page: Page, debtId = debt) {
  await page.getByTestId(`host-fee-candidate-${debtId}`).getByRole("button").click();
  await expect(detail(page)).toBeVisible();
}
async function prepare(page: Page, amount = "0,60") {
  await page.getByTestId("host-fee-amount").fill(amount);
  await page.getByTestId("host-fee-consent").check();
  await page.getByTestId("host-fee-prepare").click();
}
async function execute(page: Page) {
  await page.getByTestId("host-fee-execute-consent").check();
  await page.getByTestId("host-fee-execute").click();
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

test("host consent preserves exact gross and a single creation while paid differs from certified net", async ({ page }, info) => {
  const {state}=await mockApi(page);await page.goto("/#marketplace-host-fees");await expect(page.getByTestId("host-fees-page")).toBeVisible();
  await review(page);await expect(page.getByTestId("host-fee-prepare")).toBeDisabled();
  await page.getByTestId("host-fee-amount").fill("0,49");await expect(page.getByTestId("host-fee-consent")).toBeDisabled();
  await expect(page.getByTestId("host-fee-prepare")).toBeDisabled();expect(state.posts).toHaveLength(0);
  await prepare(page);await expect(page.getByTestId("host-fee-execute")).toBeDisabled();
  expect(state.posts[0].body).toEqual({debt_id:debt,collection_id:state.id,gross_amount_cents:60,confirmed:true});
  expect(state.id).toMatch(/^mhostfee_[a-f0-9]{32}$/);await execute(page);
  await expect(page.getByTestId("host-fee-checkout")).toHaveAttribute("href","https://checkout.stripe.com/c/pay/cs_test_fixture");
  expect(financialPosts(state,"/execute")).toHaveLength(1);
  await page.getByTestId("host-fee-reconcile").click();await expect(detail(page)).toContainText("Pagamento em conciliação");
  expect(state.collected).toBe(0);expect(state.obligationClosed).toBe(false);await expect(page.getByTestId("host-fee-obligation-close")).toBeDisabled();
  state.nextObservation="credited";await page.getByTestId("host-fee-reconcile").click();
  await expect(detail(page)).toContainText("Crédito líquido conciliado");expect(state.collected).toBe(30);expect(state.obligationClosed).toBe(true);
  await refreshAndReview(page);await expect(detail(page)).toContainText("Obrigação individual quitada");await expect(page.getByTestId("host-fee-obligation-close")).toHaveCount(0);
  expect(financialPosts(state,"/hosted")).toHaveLength(1);expect(financialPosts(state,"/execute")).toHaveLength(1);
  await page.emulateMedia({colorScheme:"light"});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("host-certified-light.png"),fullPage:true});
  await page.emulateMedia({colorScheme:"dark"});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("host-certified-dark.png"),fullPage:true});
});
test("lost approval and creation replies recover through exact GET and refresh without financial retries",async({page})=>{
  const {state,active}=await mockApi(page,{lostApproval:true,lostCreation:true});await page.goto("/#marketplace-host-fees");await review(page);await prepare(page);
  await expect(page.getByTestId("host-fee-consult-approval")).toBeVisible();expect(financialPosts(state,"/hosted")).toHaveLength(1);
  await page.getByTestId("host-fee-consult-approval").click();await expect(detail(page)).toContainText("Autorização registrada");
  await execute(page);await expect(page.getByTestId("host-fee-consult-state")).toBeVisible();expect(financialPosts(state,"/execute")).toHaveLength(1);
  const id=state.id;await page.reload();await review(page);await expect(detail(page)).toContainText("Criação em verificação");
  active()!.status="open";await page.getByTestId("host-fee-consult-state").click();
  await expect(page.getByTestId("host-fee-checkout")).toBeVisible();
  expect(state.requests.some(r=>r.path===`${root}/${id}`&&r.method==="GET")).toBe(true);
  expect(financialPosts(state,"/hosted")).toHaveLength(1);expect(financialPosts(state,"/execute")).toHaveLength(1);
  expect(financialPosts(state,"/reconcile")).toHaveLength(0);
});
test("partial host net keeps its balance and requires fresh gross consent for a second collection",async({page})=>{
  const {state}=await mockApi(page);state.nextObservation="credited";state.nextProcessingFee=35;
  await page.goto("/#marketplace-host-fees");await review(page);await prepare(page,"0,50");await execute(page);await page.getByTestId("host-fee-reconcile").click();
  await expect(detail(page)).toContainText("Crédito líquido conciliado");expect(state.collected).toBe(15);expect(state.obligationClosed).toBe(false);
  const first=state.id;await refreshAndReview(page);await expect(detail(page)).toContainText("R$ 0,15");
  await expect(page.getByTestId("host-fee-consent")).not.toBeChecked();await expect(page.getByTestId("host-fee-prepare")).toBeDisabled();
  await prepare(page,"0,50");await execute(page);await page.getByTestId("host-fee-reconcile").click();
  await expect(detail(page)).toContainText("Crédito líquido conciliado");expect(state.collected).toBe(30);expect(state.id).not.toBe(first);
  expect(state.obligationClosed).toBe(true);expect(financialPosts(state,"/hosted")).toHaveLength(2);expect(financialPosts(state,"/execute")).toHaveLength(2);
});
test("host excess remains held until explicit return consent and never grants premature closure",async({page})=>{
  const {state}=await mockApi(page);state.nextObservation="credited";await page.goto("/#marketplace-host-fees");await review(page);await prepare(page,"0,70");await execute(page);
  await page.getByTestId("host-fee-reconcile").click();await expect(detail(page)).toContainText("Crédito líquido conciliado");
  expect(state.collected).toBe(30);expect(state.excess).toBe(10);await refreshAndReview(page);
  await expect(detail(page)).toContainText("Taxas cobertas, excedente retido");await expect(page.getByTestId("host-fee-obligation-close")).toBeDisabled();
  expect(state.obligationClosed).toBe(false);expect(state.posts.some(p=>/close|refund|excess\/return/.test(p.path))).toBe(false);
});

test("host excess requires exact consent and certified return before automatic individual closure", async ({ page }, info) => {
  const { state } = await mockApi(page); state.nextObservation = "credited";
  await page.goto("/#marketplace-host-fees"); await review(page); await prepare(page, "0,70"); await execute(page);
  await page.getByTestId("host-fee-reconcile").click(); await expect(page.getByTestId("host-fee-excess-return")).toBeDisabled();
  const consent = page.getByTestId("host-fee-excess-consent");
  await expect(consent.locator("..")).toContainText("Autorizo devolver R$ 0,10 ao cartão usado nesta cobrança.");
  await consent.focus(); await page.keyboard.press("Space"); await expect(consent).toBeChecked();
  await page.getByTestId("host-fee-excess-return").click(); await expect(detail(page)).toContainText("Devolução do excedente em verificação");
  expect(financialPosts(state, "/excess/return")).toEqual([{ path: `${root}/${state.id}/excess/return`, body: { amount_cents: 10, confirmed: true } }]);
  expect(state.excess).toBe(10); expect(state.obligationClosed).toBe(false);
  await page.getByTestId("host-fee-reconcile").click(); await expect(detail(page)).toContainText("Devolução do excedente confirmada");
  await expect(detail(page)).toContainText("Obrigação individual quitada");
  expect(state.excess).toBe(0); expect(state.journals[0].excess).toBe(10); expect(state.journals[0].returned).toBe(10);
  expect(financialPosts(state, "/excess/return")).toHaveLength(1); expect(financialPosts(state, "/close")).toHaveLength(0);
  expect(state.requests.some(value => value.path.startsWith("/marketplace/dashboard/seller-fee-collections"))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("host-excess-certified-terminal.png"), fullPage: true });
});

test("lost host excess response stays GET-only across reload and a stale held receipt", async ({ page }) => {
  const { state, active } = await mockApi(page, { lostExcessReturn: true }); state.nextObservation = "credited";
  await page.goto("/#marketplace-host-fees"); await review(page); await prepare(page, "0,70"); await execute(page);
  await page.getByTestId("host-fee-reconcile").click(); await page.getByTestId("host-fee-excess-consent").check();
  await page.getByTestId("host-fee-excess-return").click(); await expect(page.getByRole("alert")).toContainText("esta solicitação não será reenviada");
  active()!.excessStatus = "held"; await page.reload(); await review(page);
  await page.getByTestId(`host-fee-journal-${state.id}`).getByRole("button").click();
  await expect(page.getByTestId("host-fee-excess-return")).toHaveCount(0);
  const before = state.requests.length; await page.getByTestId("host-fee-consult-state").click();
  await expect.poll(() => state.requests.slice(before).filter(value => value.path === `${root}/${state.id}` && value.method === "GET").length).toBe(1);
  expect(state.requests.slice(before).filter(value => value.path.startsWith(root)).every(value => value.method === "GET")).toBe(true);
  expect(financialPosts(state, "/excess/return")).toHaveLength(1);
  active()!.excessStatus = "unknown"; await page.getByTestId("host-fee-reconcile").click();
  await expect(detail(page)).toContainText("Devolução do excedente confirmada"); expect(financialPosts(state, "/excess/return")).toHaveLength(1);
});

test("a merchant switch discards host excess consent without sending a refund", async ({ page }) => {
  const { state } = await mockApi(page); state.nextObservation = "credited";
  await page.goto("/#marketplace-host-fees"); await review(page); await prepare(page, "0,70"); await execute(page);
  await page.getByTestId("host-fee-reconcile").click(); await page.getByTestId("host-fee-excess-consent").check();
  await switchMerchant(page); await expect(detail(page)).toHaveCount(0);
  await expect(page.getByTestId("host-fee-excess-consent")).toHaveCount(0); expect(financialPosts(state, "/excess/return")).toHaveLength(0);
});
test("MVP capabilities keep host history recoverable without new collections or Checkout", async ({ page }, info) => {
  const { state } = await mockApi(page, { initial: "approved", newCollectionsBlocked: true, customerMissing: true });
  const approvedId = state.id, paidId = `${approvedId}_older`;
  state.journals.push({ id: paidId, status: "paid", gross: 50, maximum: 30, credit: 0, processingFee: 0, excess: 0 });
  await page.goto("/#marketplace-host-fees");
  await expect(page).toHaveURL(/#marketplace-host-fees$/); await expect(page.getByTestId("host-fees-page")).toBeVisible();
  const navigation = page.locator(".console-mobile-nav"); await expect(navigation).toHaveCount(1);
  await expect(navigation.locator('option[value="marketplace-fees"]')).toHaveCount(0);
  await expect(navigation.locator('option[value="marketplace-host-fees"]')).toHaveCount(0);
  await expect(page.getByTestId("host-fees-page")).toContainText("Modo de recuperação"); await review(page);
  await expect(page.getByTestId("host-fees-page")).not.toContainText("autorize o pagamento");
  await expect(detail(page)).not.toContainText("Conclua a configuração de cobrança");
  await expect(page.getByTestId("host-fee-amount")).toHaveCount(0);
  await expect(page.getByTestId("host-fee-prepare")).toHaveCount(0);
  await page.getByTestId(`host-fee-journal-${approvedId}`).getByRole("button").click();
  await expect(detail(page)).toContainText("Autorização registrada"); await expect(detail(page)).toContainText("R$ 0,60");
  await expect(page.getByTestId("host-fee-execute")).toHaveCount(0);
  await expect(page.getByTestId("host-fee-execute-consent")).toHaveCount(0);
  await expect(page.getByTestId("host-fee-checkout")).toHaveCount(0);
  const beforeLookup = state.requests.length; await page.getByTestId("host-fee-consult-state").click();
  await expect.poll(() => state.requests.slice(beforeLookup).filter(value => value.path === `${root}/${approvedId}` && value.method === "GET").length).toBe(1);
  expect(state.posts).toHaveLength(0);
  await page.getByTestId(`host-fee-journal-${paidId}`).getByRole("button").click();
  await expect(detail(page)).toContainText("Pagamento em conciliação"); state.nextObservation = "credited"; state.nextProcessingFee = 35;
  await page.getByTestId("host-fee-reconcile").click(); await expect(detail(page)).toContainText("Crédito líquido conciliado");
  expect(state.collected).toBe(15);
  expect(state.posts).toEqual([{ path: `${root}/${paidId}/reconcile`, body: { confirmed: true } }]);
  await expect(page.getByTestId(`host-fee-journal-${approvedId}`)).toBeVisible();
  await expect(page.getByTestId("host-fee-prepare")).toHaveCount(0); await expect(page.getByTestId("host-fee-checkout")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("host-mvp-history-recovery.png"), fullPage: true });
});

test("a real merchant switch clears host approval and execution consent before any creation",async({page})=>{
  const {state}=await mockApi(page);await page.goto("/#marketplace-host-fees");await review(page);await prepare(page);
  await page.getByTestId("host-fee-execute-consent").check();const first=state.id;
  await switchMerchant(page);await expect(detail(page)).toHaveCount(0);await expect(page.getByTestId("host-fee-execute-consent")).toHaveCount(0);
  await expect(page.getByTestId(`host-fee-candidate-${debt}`)).toHaveCount(0);expect(state.merchant).toBe("host-b");
  expect(financialPosts(state,"/hosted")).toHaveLength(1);expect(financialPosts(state,"/execute")).toHaveLength(0);
  expect(state.requests.filter(r=>r.path===`${root}/${first}`&&r.method!=="GET")).toHaveLength(0);
});
test("blocked subscription return consumes only the host query by GET and ignores fabricated success flags",async({page})=>{
  const {state}=await mockApi(page,{blockedSubscription:true,initial:"creating"});
  await page.goto("/?host_fee_collection_id=host_fee_collection_aurora&collection_id=seller_foreign&status=paid&success=true#marketplace-host-fees");
  await expect(page.getByTestId("host-fees-page")).toBeVisible();await expect(detail(page)).toContainText("Criação em verificação");
  expect(state.posts).toHaveLength(0);expect(state.collected).toBe(0);expect(state.obligationClosed).toBe(false);
  expect(state.requests.filter(r=>r.path===`${root}/host_fee_collection_aurora`&&r.method==="GET")).toHaveLength(1);
  expect(state.requests.some(r=>r.path.includes("seller_foreign")||r.path.startsWith("/marketplace/dashboard/seller-fee-collections"))).toBe(false);
  expect(new URL(page.url()).searchParams.has("host_fee_collection_id")).toBe(false);
  state.merchant="host-b";await page.reload();await expect(page.getByText("Nenhuma taxa disponível",{exact:true})).toBeVisible();
  await expect(detail(page)).toHaveCount(0);expect(state.posts).toHaveLength(0);
  expect(state.requests.filter(r=>r.path===`${root}/host_fee_collection_aurora`&&r.method==="GET")).toHaveLength(1);
});

