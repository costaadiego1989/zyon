import { test, expect, type Page } from "@playwright/test";

// The real dashboard runs in Chromium. All API transport below is simulated.
const uuid = "12345678-abcd-abcd-abcd-1234567890ab";
const labelUrl = "https://sandbox.melhorenvio.com.br/imprimir/privateFixture?signature=never-store-this";
async function mockApi(page: Page, options: { role?: string; expired?: boolean; noAuth?: boolean; timeout?: boolean; wrongReceipt?: boolean; invalidList?: boolean;
  labels?: boolean; printUrl?: string; printError?: boolean; printWrongOrigin?: boolean; delayPrint?: boolean; multiVolume?: boolean } = {}) {
  const state = { merchant: "host-a", listError: false, empty: false, postState: "confirmed", getState: "confirmed", posts: [] as any[],
    requests: [] as Array<{ path: string; method: string }>, printBodies: [] as unknown[], printsDisabled: false, printReplied: false, releasePrint: () => {} };
  const role = options.role ?? "owner";
  function row(id: string, recovery = "required") {
    return { shipment_id: id, payment_intent_id: `pay_${id}`, origin_merchant_id: "seller-a", origin_name: "Loja Horizonte",
      reference: `mship_${"a".repeat(64)}`, created_at: "2026-09-30T15:00:00Z", status: recovery === "confirmed" ? "cart_created" : recovery === "not_applicable" ? "prepared" : "cart_unknown",
      carrier_order_id: recovery === "confirmed" ? uuid : null, recovery_status: options.invalidList ? "private_carrier_payload" : recovery, can_recover: recovery === "required", can_print: false,
      volume_index: options.multiVolume ? 1 : 0, volume_count: options.multiVolume ? 3 : 1 };
  }
  function result(id: string, recovery: string) {
    const full = row(id, recovery);
    return { shipment_id: full.shipment_id, origin_merchant_id: full.origin_merchant_id, reference: full.reference,
      status: full.status, recovery_status: full.recovery_status, carrier_order_id: full.carrier_order_id };
  }
  await page.route("**/audit-api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace("/audit-api/v1", "");
    state.requests.push({ path, method: request.method() });
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/merchants/me") return options.noAuth ? json({}, 401) : json({ id: state.merchant, name: state.merchant === "host-a" ? "Loja Aurora" : "Loja Horizonte", user_id: "operator-test", role, plan: "BOTH" });
    if (path === "/auth/refresh") return json({}, 401);
    if (path === "/merchants/me/store-settings") return json({});
    if (path === "/billing/subscription") return json({ plan: "starter", status: "canceled", trial_expired: options.expired ?? false, features: { marketplace: false } });
    if (path === "/billing/plans") return json([]);
    if (path === "/onboarding") return json({ completed: true, steps: [] });
    if (path === "/merchants/me/stores") return json({ data: [{ id: "host-a", name: "Loja Aurora", role }, { id: "host-b", name: "Loja Horizonte", role }] });
    if (path === "/merchants/me/stores/host-b/activate") { state.merchant = "host-b"; return json({ merchant_id: "host-b" }); }
    if (path === "/marketplace/dashboard/shipments") {
      if (state.listError) return json({ message: "PRIVATE_CARRIER_TOKEN" }, 503);
      const shipments = state.empty || state.merchant === "host-b" ? [] : options.labels ? [
        { ...row("shipment_generated", "confirmed"), status: "generated", can_print: !state.printsDisabled },
        { ...row("shipment_purchase_unknown", "confirmed"), status: "purchase_unknown" },
        { ...row("shipment_canceled", "confirmed"), status: "generated" },
      ] : url.searchParams.has("cursor") ? [row("shipment_older", "not_applicable")] :
        [row("shipment_aurora"), row("shipment_inflight", "in_flight"), row("shipment_confirmed", "confirmed"), row("shipment_prepared", "not_applicable")];
      return json({ shipments, next_cursor: shipments.length === 4 ? "shipment_prepared" : null });
    }
    if (path.endsWith("/print-link")) {
      state.printBodies.push(request.postDataJSON());
      if (options.delayPrint) await new Promise<void>(resolve => { state.releasePrint = resolve; });
      if (options.printError) return json({ message: `PRIVATE_CARRIER_ERROR ${labelUrl}` }, 502);
      await json({ shipmentId: path.split("/").at(-2), originMerchantId: options.printWrongOrigin ? "foreign_seller" : "seller-a",
        carrierOrderId: uuid, mode: "private", requiresCarrierLogin: true, url: options.printUrl ?? labelUrl });
      state.printReplied = true; return;
    }
    if (path.endsWith("/recover-cart")) {
      state.posts.push(request.postDataJSON());
      if (options.timeout) return route.abort("connectionreset");
      return json(result(options.wrongReceipt ? "foreign_shipment" : path.split("/").at(-2)!, state.postState), state.postState === "confirmed" ? 200 : 202);
    }
    if (path.endsWith("/recovery")) return json(result(path.split("/").at(-2)!, state.getState));
    if (path.includes("notification")) return json({ notifications: [], unread_count: 0 });
    if (path.endsWith("/domains")) return json([]);
    if (path === "/dashboard/nav-counts") return json({ orders: 0, messages: 0, cartRecovery: 0 });
    return json({});
  });
  await page.route(/^https?:\/\/(?!localhost:5190)/, route => route.abort());
  return state;
}
const shipment = (page: Page, id = "shipment_aurora") => page.getByRole("row").filter({ has: page.getByText(id, { exact: true }) });
test("multiple packages identify the selected volume in recovery and private-label access", async ({ page }, info) => {
  await mockApi(page, { multiVolume: true }); await page.goto("/#marketplace-shipments");
  await expect(shipment(page)).toContainText("Volume 2 de 3");
  await shipment(page).getByRole("button", { name: "Recuperar identificador" }).click();
  await expect(page.locator(".marketplace-shipments__confirmation")).toContainText("Volume 2 de 3");
  await expect(page.locator(".marketplace-shipments__confirmation")).toContainText("Confira o pacote correspondente");
  await page.unrouteAll(); await mockApi(page, { multiVolume: true, labels: true }); await page.reload();
  await shipment(page, "shipment_generated").getByRole("button", { name: "Obter etiqueta" }).click();
  await expect(page.locator(".marketplace-shipments__confirmation")).toContainText("Volume 2 de 3");
  await expect(page.locator(".marketplace-shipments__confirmation")).toContainText("Cada volume tem sua própria etiqueta");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".marketplace-shipments__confirmation").screenshot({ path: info.outputPath("phase19-private-volume-label.png") });
});
async function review(page: Page) {
  await shipment(page).getByRole("button", { name: "Recuperar identificador" }).click();
  await page.getByLabel("Identificador (UUID) do Melhor Envio").fill(uuid.toUpperCase());
}

test("UUID validation, explicit confirmation and GET-only refresh preserve the confirmed identifier", async ({ page }, info) => {
  const state = await mockApi(page); await page.goto("/#marketplace-shipments");
  await expect(page.getByRole("heading", { name: "Remessas do marketplace" })).toBeVisible();
  await expect(shipment(page)).toContainText("Identificador pendente");
  await expect(shipment(page, "shipment_inflight")).toContainText("Aguardando resposta");
  await expect(shipment(page, "shipment_confirmed")).toContainText("Identificador confirmado");
  await expect(shipment(page, "shipment_prepared")).toContainText("Recuperação indisponível");
  await shipment(page).getByRole("button", { name: "Recuperar identificador" }).click();
  await expect(page.getByRole("heading", { name: "Conferir identificador da remessa" })).toBeFocused();
  const input = page.getByLabel("Identificador (UUID) do Melhor Envio"), confirm = page.getByRole("button", { name: "Confirmar recuperação do identificador" });
  await expect(confirm).toBeDisabled(); await input.fill("not-a-uuid"); await expect(confirm).toBeDisabled();
  await expect(input).toHaveAttribute("aria-invalid", "true"); await input.fill(uuid.toUpperCase());
  await expect(page.locator(".platform-feedback-fab")).toBeHidden(); expect(state.posts).toHaveLength(0);
  await page.locator(".marketplace-shipments__confirmation").screenshot({ path: info.outputPath("confirmation.png") });
  await confirm.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("confirmation-action.png") });
  await confirm.click(); await expect(shipment(page)).toContainText("Identificador confirmado");
  await expect(shipment(page)).toContainText(uuid); expect(state.posts).toEqual([{ carrierOrderId: uuid }]);
  await shipment(page).getByRole("button", { name: "Consultar estado" }).click(); expect(state.posts).toHaveLength(1);
  await expect(shipment(page).getByRole("button", { name: "Recuperar identificador" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("confirmed.png"), fullPage: true });
});

test("a private-link response arriving after tenant switch cannot expose the previous merchant label", async ({ page }) => {
  const state = await mockApi(page, { labels: true, delayPrint: true }); await page.goto("/#marketplace-shipments");
  await shipment(page, "shipment_generated").getByRole("button", { name: "Obter etiqueta" }).click();
  await expect.poll(() => state.printBodies.length).toBe(1);
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
  await expect(page.getByText("Nenhuma remessa do marketplace", { exact: true })).toBeVisible();
  // Store activation reloads the document and can abort its old request. The
  // delayed server response must still never expose that merchant's link.
  state.releasePrint(); await expect.poll(() => state.printReplied).toBe(true);
  await expect(page.getByRole("link", { name: /Abrir etiqueta/ })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("shipment_generated"); expect(state.printBodies).toHaveLength(1);
});

test("generated label uses explicit private-link access without new purchase and clears the link on refresh", async ({ page }, info) => {
  const state = await mockApi(page, { labels: true }); await page.goto("/#marketplace-shipments");
  const generated = shipment(page, "shipment_generated");
  await expect(generated.getByRole("button", { name: "Obter etiqueta" })).toBeVisible();
  await expect(shipment(page, "shipment_purchase_unknown")).toContainText("A emissão permanece bloqueada; não compre novamente");
  await expect(shipment(page, "shipment_purchase_unknown").getByRole("button", { name: "Obter etiqueta" })).toHaveCount(0);
  await expect(shipment(page, "shipment_canceled").getByRole("button", { name: "Obter etiqueta" })).toHaveCount(0);
  expect(state.printBodies).toHaveLength(0); await generated.getByRole("button", { name: "Obter etiqueta" }).click();
  await expect(page.getByRole("heading", { name: "Etiqueta disponível" })).toBeFocused();
  const link = page.getByRole("link", { name: /Abrir etiqueta no Melhor Envio/ });
  await expect(link).toHaveAttribute("href", labelUrl); await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("referrerpolicy", "no-referrer"); await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.getByText(/mesma conta de/)).toContainText("Loja Horizonte");
  expect(state.printBodies).toEqual([{}]); expect(state.posts).toHaveLength(0);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain("never-store-this");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(".marketplace-shipments__confirmation").screenshot({ path: info.outputPath("private-label.png") });
  await generated.getByRole("button", { name: "Consultar estado" }).click(); await expect(link).toHaveCount(0);
  state.printsDisabled = true; await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(generated.getByRole("button", { name: "Obter etiqueta" })).toHaveCount(0); expect(state.printBodies).toHaveLength(1);
});

test("private label remains available after downgrade and disappears on merchant switch", async ({ page }) => {
  const state = await mockApi(page, { labels: true, expired: true }); await page.goto("/#marketplace-shipments");
  await shipment(page, "shipment_generated").getByRole("button", { name: "Obter etiqueta" }).click();
  await expect(page.getByRole("link", { name: /Abrir etiqueta/ })).toBeVisible();
  await page.getByRole("button", { name: "Voltar à assinatura" }).click(); await expect(page.getByRole("link", { name: /Abrir etiqueta/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Gerenciar remessas existentes do marketplace" }).click();
  await expect(shipment(page, "shipment_generated")).toBeVisible(); await expect(page.getByRole("link", { name: /Abrir etiqueta/ })).toHaveCount(0);
  expect(state.printBodies).toHaveLength(1);
  await page.unrouteAll(); const active = await mockApi(page, { labels: true, role: "admin", expired: true }); await page.reload();
  await shipment(page, "shipment_generated").getByRole("button", { name: "Obter etiqueta" }).click();
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
  await expect(page.getByText("Nenhuma remessa do marketplace", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Abrir etiqueta/ })).toHaveCount(0); expect(active.printBodies).toHaveLength(1);
});

for (const [name, options] of [
  ["foreign URL", { printUrl: "https://external.example/imprimir/stolen" }],
  ["unsafe URL", { printUrl: "javascript:alert(1)" }],
  ["foreign origin", { printWrongOrigin: true }],
  ["provider error", { printError: true }],
] as const) test(`print response rejects ${name} without exposing secrets or automatically retrying`, async ({ page }) => {
  const state = await mockApi(page, { labels: true, ...options }); await page.goto("/#marketplace-shipments");
  await shipment(page, "shipment_generated").getByRole("button", { name: "Obter etiqueta" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível disponibilizar a etiqueta");
  await expect(page.getByRole("link", { name: /Abrir etiqueta/ })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("PRIVATE_CARRIER_ERROR");
  await expect(page.locator("body")).not.toContainText("never-store-this"); expect(state.printBodies).toHaveLength(1);
  await page.getByRole("button", { name: "Atualizar lista" }).click(); expect(state.printBodies).toHaveLength(1);
});

test("lost response remains uncertain while GET reads do not resubmit", async ({ page }) => {
  const state = await mockApi(page, { timeout: true }); state.getState = "required";
  await page.goto("/#marketplace-shipments"); await review(page);
  await page.getByRole("button", { name: "Confirmar recuperação do identificador" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível confirmar");
  await expect(shipment(page)).toContainText("Solicitação sem confirmação");
  await shipment(page).getByRole("button", { name: "Consultar estado" }).click();
  await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(shipment(page).getByRole("button", { name: "Recuperar identificador" })).toHaveCount(0);
  state.getState = "confirmed"; await shipment(page).getByRole("button", { name: "Consultar estado" }).click();
  await expect(shipment(page)).toContainText("Identificador confirmado"); expect(state.posts).toHaveLength(1);
});

test("a definitive unconfirmed response preserves the draft without automatically retrying", async ({ page }) => {
  const state = await mockApi(page); state.postState = "required"; await page.goto("/#marketplace-shipments"); await review(page);
  await page.getByRole("button", { name: "Confirmar recuperação do identificador" }).click();
  await expect(page.getByRole("status")).toContainText("O identificador ainda não foi confirmado");
  await expect(page.getByLabel("Identificador (UUID) do Melhor Envio")).toHaveValue(uuid.toUpperCase());
  expect(state.posts).toHaveLength(1); await page.getByRole("button", { name: "Voltar sem vincular" }).click();
  expect(state.posts).toHaveLength(1);
});

test("pagination, empty state and neutral retry are read-only", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#marketplace-shipments");
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(shipment(page, "shipment_older")).toBeVisible();
  await expect(page.getByRole("button", { name: "Próxima", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect(shipment(page)).toBeVisible(); state.listError = true;
  await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.locator("body")).not.toContainText("PRIVATE_CARRIER_TOKEN");
  state.listError = false; state.empty = true; await page.getByRole("button", { name: "Atualizar lista" }).click();
  await expect(page.getByText("Nenhuma remessa do marketplace", { exact: true })).toBeVisible();
  expect(state.requests.filter(row => row.path.includes("/marketplace/dashboard/shipments")).every(row => row.method === "GET")).toBe(true);
});

test("staff and unauthenticated sessions cannot load remessas or expose recovery controls", async ({ page }) => {
  const state = await mockApi(page, { role: "staff" }); await page.goto("/#marketplace-shipments");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recuperar identificador" })).toHaveCount(0);
  expect(state.requests.filter(row => row.path.includes("/marketplace/dashboard/shipments"))).toHaveLength(0);
  await page.unrouteAll(); const noAuth = await mockApi(page, { noAuth: true });
  await page.goto("/?mode=login#marketplace-shipments");
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  expect(noAuth.requests.filter(row => row.path.includes("/marketplace/dashboard/shipments"))).toHaveLength(0);
});

test("expired owner plan opens only existing obligations and preserves the payment remediation entry", async ({ page }, info) => {
  const state = await mockApi(page, { expired: true }); await page.goto("/#marketplace-shipments");
  await expect(shipment(page)).toBeVisible(); await expect(page.locator(".dashboard-shell")).toHaveCount(0);
  await review(page); await page.getByRole("button", { name: "Confirmar recuperação do identificador" }).click();
  await expect(shipment(page)).toContainText("Identificador confirmado"); expect(state.posts).toHaveLength(1);
  await page.getByRole("button", { name: "Voltar à assinatura" }).click();
  await expect(page.getByRole("button", { name: "Gerenciar cobranças existentes do marketplace" })).toBeVisible();
  await page.getByRole("button", { name: "Gerenciar remessas existentes do marketplace" }).click();
  await expect(shipment(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath("expired-remediation.png"), fullPage: true });
});

test("admin recovery remains available after downgrade", async ({ page }) => {
  const state = await mockApi(page, { role: "admin", expired: true }); await page.goto("/#marketplace-shipments"); await review(page);
  await page.getByRole("button", { name: "Confirmar recuperação do identificador" }).click();
  await expect(shipment(page)).toContainText("Identificador confirmado"); expect(state.posts).toHaveLength(1);
});

test("switching merchants clears prior rows and unsubmitted UUID", async ({ page }) => {
  const state = await mockApi(page); await page.goto("/#marketplace-shipments"); await review(page);
  await page.locator(".merchant-store-switcher").getByRole("button", { name: "Loja Aurora", exact: true }).click();
  await page.getByRole("dialog", { name: "Trocar loja" }).getByRole("button", { name: /Loja Horizonte/ }).click();
  await expect(page.getByText("Nenhuma remessa do marketplace", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("shipment_aurora");
  await expect(page.getByLabel("Identificador (UUID) do Melhor Envio")).toHaveCount(0); expect(state.posts).toHaveLength(0);
});

test("receipt for a different shipment cannot clear uncertain state", async ({ page }) => {
  const state = await mockApi(page, { wrongReceipt: true }); await page.goto("/#marketplace-shipments"); await review(page);
  await page.getByRole("button", { name: "Confirmar recuperação do identificador" }).click();
  await expect(shipment(page)).toContainText("Solicitação sem confirmação");
  await expect(page.locator("body")).not.toContainText("foreign_shipment"); expect(state.posts).toHaveLength(1);
});

test("malformed financial state is rejected without rendering internal values", async ({ page }) => {
  const state = await mockApi(page, { invalidList: true }); await page.goto("/#marketplace-shipments");
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar");
  await expect(page.locator("body")).not.toContainText("private_carrier_payload"); expect(state.posts).toHaveLength(0);
});

test("GET resolves in-flight eligibility and closes stale confirmation without POST", async ({ page }) => {
  const state = await mockApi(page); state.getState = "required"; await page.goto("/#marketplace-shipments");
  const inFlight = shipment(page, "shipment_inflight");
  await expect(inFlight.getByRole("button", { name: "Recuperar identificador" })).toHaveCount(0);
  await inFlight.getByRole("button", { name: "Consultar estado" }).click();
  await expect(inFlight.getByRole("button", { name: "Recuperar identificador" })).toBeVisible();
  await review(page); state.getState = "confirmed"; await shipment(page).getByRole("button", { name: "Consultar estado" }).click();
  await expect(page.getByRole("button", { name: "Confirmar recuperação do identificador" })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});
