import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

const widgetUrl = process.env.WIDGET_RECOVERY_TEST_URL ?? "http://127.0.0.1:5174";

async function setup(page: Page, theme = "light", unavailable = false,
  payment?: { method: "pix" | "boleto" | "card"; status: string; normal?: boolean; unavailable?: boolean },
  display?: { normal?: boolean; failures?: number }, navigation?: "payment_methods" | "shipping_options") {
  let currentId = "", recovered = false;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const messages: string[] = [], calls: string[] = [];
  const displays: unknown[] = [];
  const displayRef = { turn_id: "turn-visible", text_hash: createHash("sha256").update("Esta é a resposta que ficou salva.").digest("hex") };
  const state = () => ({ protocol: "durable_v2", session_id: "bound-session", conversation_id: "conversation-real",
    turns: currentId ? [
      { id: "saved:buyer", role: "buyer", text: "Pode explicar esta etapa?", occurred_at: "2026-09-25T02:00:00.000Z" },
      { id: "saved:agent", role: "agent", text: "Esta é a resposta que ficou salva.", occurred_at: "2026-09-25T02:00:00.000Z",
        ...(navigation && recovered ? { checkout_stage: "payment", blocks: [{ type: navigation, data: navigation === "payment_methods"
          ? { methods: [{ key: "pix", label: "Pix", sub: "Pagamento instantâneo" }] }
          : { selection_mode: "chat", options: [{ key: "chat-shipping-0", label: "Correios PAC", cost: 1234, sub: "5 dias úteis" }] } }] } : {}),
        ...(display && recovered ? { display_ref: displayRef } : {}) },
    ] : [],
    ...(currentId ? { request: { message_id: currentId, status: recovered ? "reconciled" : "unknown" } } : {}),
    ...(currentId && !recovered ? { active_request: { message_id: currentId, status: "unknown" } } : {}),
    ...(payment && recovered ? { payment_intent_id: "pay_recovered_fixture" } : {}),
  });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.fallback() : route.abort());
  await page.route("**/embed/**", async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/embed/start") return json({ session_id: "bound-session", conversation_id: "conversation-real", chat_protocol: "durable_v2",
      experience: { brand: { name: "Loja de teste", theme: { mode: theme } }, agent: { name: "Assistente" },
        ...(navigation ? { paymentMethods: { pix: true, card: false, boleto: false } } : {}),
        items: [{ sku: "P1", name: "Produto de teste", unit_price: 99.9, quantity: 1 }], totals: { subtotal: 99.9, total: 99.9 }, rules: { showBranding: false } } });
    if (path === "/embed/chat/state") return json(state());
    if (path === "/embed/chat/display") {
      expect(display).toBeDefined();
      const body = route.request().postDataJSON();
      expect(body).toEqual({ session_id: "bound-session", conversation_id: "conversation-real",
        display_ref: displayRef, definition: "widget-visible-text-v1" });
      displays.push(body);
      if (displays.length <= (display?.failures ?? 0)) return json({}, 503);
      return json({ status: "recorded", recorded_at: "2026-09-25T02:00:01Z" });
    }
    if (path === "/embed/chat/payment" && payment) {
      expect(route.request().method()).toBe("GET");
      expect(new URL(route.request().url()).searchParams.get("intent_id")).toBe("pay_recovered_fixture");
      if (payment.unavailable) return json({ code: "chat_payment_not_available" }, 404);
      return json({ id: "pay_recovered_fixture", method: payment.method, status: payment.status, amountCents: 10200,
        buyerFacing: { qrCodeCopyPaste: "fixture-only-pix-code", invoiceUrl: "https://example.invalid/invoice" } });
    }
    if (path === "/embed/payment/intents/pay_recovered_fixture/status") return json({ status: payment?.status });
    if (path === "/embed/chat") {
      const body = route.request().postDataJSON();
      expect(body.conversation_id).toBe("conversation-real");
      expect(body.message_id).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
      messages.push(body.message_id);
      if (recovered) return json({ message: "Podemos continuar.", stage: "customer_data", missing_fields: [], chat_request: { message_id: body.message_id, status: "completed" } });
      currentId = body.message_id;
      if (display?.normal) {
        recovered = true;
        return json({ message: "Esta é a resposta que ficou salva.", stage: "customer_data", display_ref: displayRef,
          chat_request: { message_id: currentId, status: "completed" } });
      }
      if (payment?.normal) {
        recovered = true;
        return json({ message: "Acompanhe o pagamento.", stage: "payment_pending",
          chat_request: { message_id: currentId, status: "completed" } });
      }
      return json({ code: "chat_message_reconciliation_required", chat_request: { message_id: currentId, status: "unknown", next_action: "refresh_session" } }, 503);
    }
    if (path === "/embed/chat/reconcile") {
      const body = route.request().postDataJSON();
      expect(body).toEqual({ session_id: "bound-session", conversation_id: "conversation-real", message_id: currentId });
      if (unavailable) return json({ code: "chat_message_reconciliation_required" }, 409);
      await ready;
      recovered = true;
      return json({ chat_request: { message_id: currentId, status: "reconciled", next_action: "refresh_session" } });
    }
    if (path === "/embed/track") return json({});
    return json({ code: "unexpected_test_endpoint" }, 500);
  });
  await page.route("**/checkout-settings/widget-config**", route => route.fulfill({ json: { enabledTriggers: [], advancedRules: [] } }));
  await page.goto("/?embed=1&embedToken=fixture-token&merchantId=store&apiBaseUrl=" + encodeURIComponent(widgetUrl));
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
  return { messages, calls, displays, allowRecovery: () => { unavailable = false; release(); } };
}

for (const navigation of ["payment_methods", "shipping_options"] as const) test(`recovers current ${navigation} after loss and reload without executing a commercial action`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const f = await setup(page, "light", false, undefined, {}, navigation);
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pode explicar esta etapa?"); await input.press("Enter"); f.allowRecovery();
  const control = page.getByRole("button", { name: navigation === "payment_methods" ? /Pix/ : /Correios PAC/ });
  await expect(control).toBeVisible(); await expect(input).toBeEnabled();
  await page.reload(); await expect(control).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`navigation-${navigation}.png`), fullPage: true, animations: "disabled" });
  expect(f.messages).toHaveLength(1);
  expect(f.calls.some(path => path.includes("/payment/intents") || path.includes("/shipping/select"))).toBe(false);
  await expect(page.getByRole("button", { name: /Verificar conversa/ })).toHaveCount(0);
  if (navigation === "shipping_options") {
    await expect(control).toContainText("R$ 12,34");
    await expect(control).toContainText("5 dias úteis");
    await control.click(); await expect.poll(() => f.messages.length).toBe(2);
    expect(f.calls.some(path => path.includes("/shipping/select"))).toBe(false);
    await expect(page.getByText("Podemos continuar.", { exact: true })).toBeVisible();
    await expect(control).toHaveCount(0);
  }
});

for (const normal of [true, false]) test(`reports visible strategy text after ${normal ? "normal response" : "recovery"} and reload`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const f = await setup(page, "light", false, undefined, { normal });
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pode explicar esta etapa?"); await input.press("Enter"); f.allowRecovery();
  await expect.poll(() => f.displays.length).toBe(1);
  await expect(input).toBeEnabled();
  await page.reload(); await expect.poll(() => f.displays.length).toBe(2);
  expect(f.displays[1]).toEqual(f.displays[0]);
  expect(f.messages).toHaveLength(1);
  await expect(page.getByRole("button", { name: /Verificar conversa/ })).toHaveCount(0);
});

test("display waits for actual intersection and visible document; telemetry retry never blocks buying", async ({ page }) => {
  await page.clock.install();
  const f = await setup(page, "light", false, undefined, { normal: true, failures: 1 });
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await input.fill("Pode explicar esta etapa?"); await input.press("Enter");
  await expect(page.getByText("Esta é a resposta que ficou salva.", { exact: true })).toBeVisible();
  await page.clock.runFor(3_000); expect(f.displays).toHaveLength(0);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[role="log"]')!.style.transform = "translateY(10000px)";
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(3_000); expect(f.displays).toHaveLength(0);
  await page.evaluate(() => { document.querySelector<HTMLElement>('[role="log"]')!.style.transform = ""; });
  await page.clock.runFor(1_000);
  await expect.poll(() => f.displays.length).toBe(1);
  await expect(input).toBeEnabled();
  await page.clock.runFor(2_000); await expect.poll(() => f.displays.length).toBe(2);
  await page.clock.runFor(20_000); expect(f.displays).toHaveLength(2);
  expect(f.messages).toHaveLength(1);
});

test("display retries are bounded and stop when the chat closes", async ({ page }) => {
  await page.clock.install();
  const f = await setup(page, "light", false, undefined, { normal: true, failures: 10 });
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pode explicar esta etapa?"); await input.press("Enter");
  await expect(page.getByText("Esta é a resposta que ficou salva.", { exact: true })).toBeVisible();
  for (let i = 1; i <= 3; i++) { await page.clock.runFor(4_000); await expect.poll(() => f.displays.length).toBe(i); }
  await page.clock.runFor(30_000); expect(f.displays).toHaveLength(3);
  await expect(input).toBeEnabled();
  await page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts");
    useCheckoutStore.getState().resetSession();
  });
  await page.clock.runFor(30_000); expect(f.displays).toHaveLength(3);
});

for (const method of ["pix", "boleto", "card"] as const) test(`restores the same ${method} after loss and reload without a second creation`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const f = await setup(page, method === "card" ? "dark" : "light", false, { method, status: "requires_action" });
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pode explicar esta etapa?"); await input.press("Enter"); f.allowRecovery();
  const control = method === "pix" ? page.getByRole("button", { name: "Copiar código", exact: true })
    : page.getByRole("link", { name: method === "boleto" ? "Abrir boleto seguro" : "Continuar para o pagamento seguro" });
  await expect(control).toBeVisible(); await expect(input).toBeEnabled();
  await expect(page.getByText("Seu pagamento está disponível abaixo.", { exact: true })).toHaveCount(1);
  await expect(page.getByText(/Pagamento confirmado/, { exact: false })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath(`payment-recovery-${method}.png`), fullPage: true });
  await page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts");
    await useCheckoutStore.getState().pay("pix");
    await useCheckoutStore.getState().selectCryptoChain("base");
  });
  await page.reload(); await expect(control).toBeVisible();
  expect(f.messages).toHaveLength(1);
  expect(f.calls.filter(path => path === "/embed/chat/reconcile")).toHaveLength(1);
  expect(f.calls.filter(path => path === "/embed/chat/payment")).toHaveLength(2);
  expect(f.calls.filter(path => path === "/embed/payment/intents")).toHaveLength(0);
  await expect(page.getByRole("button", { name: /Verificar conversa|Tentar novamente/ })).toHaveCount(0);
  const retained = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
  expect(retained).not.toContain("fixture-only-pix-code");
});

test("a normal durable payment reply also displays the saved payment without a create request", async ({ page }) => {
  const f = await setup(page, "light", false, { method: "pix", status: "requires_action", normal: true });
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pix"); await input.press("Enter");
  await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toBeVisible();
  expect(f.calls.filter(path => path === "/embed/chat/reconcile")).toHaveLength(0);
  expect(f.calls.filter(path => path === "/embed/payment/intents")).toHaveLength(0);
});

test("unavailable financial details keep recovery blocked without offering another charge", async ({ page }) => {
  await page.clock.install();
  const f = await setup(page, "light", false, { method: "pix", status: "requires_action", normal: true, unavailable: true });
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pix"); await input.press("Enter");
  await expect.poll(() => f.calls.filter(path => path === "/embed/chat/payment").length).toBe(1);
  await page.clock.runFor(1_100);
  await expect.poll(() => f.calls.filter(path => path === "/embed/chat/payment").length).toBe(2);
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: /Copiar código|Tentar novamente|Verificar conversa/ })).toHaveCount(0);
  expect(f.calls.filter(path => path === "/embed/payment/intents")).toHaveLength(0);
});

for (const status of ["approved", "failed", "refunded"]) test(`restores ${status} without presenting payment controls`, async ({ page }) => {
  const f = await setup(page, "light", false, { method: "pix", status, normal: true });
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pix"); await input.press("Enter");
  const text = status === "approved" ? "Pagamento confirmado." : status === "failed" ? "O pagamento foi recusado." : "Este pagamento foi reembolsado.";
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toHaveCount(0);
  expect(f.calls.filter(path => path === "/embed/payment/intents")).toHaveLength(0);
});

for (const width of [320, 1440]) for (const theme of ["light", "dark"]) {
  test(`automatically restores the saved response at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 900 });
    const f = await setup(page, theme);
    const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await input.fill("Pode explicar esta etapa?"); await input.press("Enter");
    await expect(input).toBeDisabled();
    await expect(page.getByText("Reconectando...", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Verificar conversa|Tentar novamente/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`recovery-${width}-${theme}.png`), fullPage: true });
    f.allowRecovery();
    await expect(page.getByText("Esta é a resposta que ficou salva.", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Pode explicar esta etapa?", { exact: true })).toHaveCount(1);
    await expect(input).toBeEnabled(); await expect(input).toBeFocused();
    expect(f.messages).toHaveLength(1);
    expect(f.calls.filter(path => path === "/embed/chat/reconcile")).toHaveLength(1);
    expect(f.calls.some(path => /payment|shipping|offers/.test(path))).toBe(false);
    await input.fill("Entendi"); await input.press("Enter");
    await expect(page.getByText("Podemos continuar.", { exact: true })).toBeVisible();
    expect(f.messages).toHaveLength(2); expect(new Set(f.messages).size).toBe(2);
  });
}

test("reload automatically resumes with the original key without a second send", async ({ page }) => {
  const f = await setup(page, "light", true);
  await page.getByRole("textbox", { name: "Mensagem", exact: true }).fill("Pode explicar esta etapa?");
  await page.getByRole("textbox", { name: "Mensagem", exact: true }).press("Enter");
  await expect.poll(() => f.calls.filter(path => path === "/embed/chat/reconcile").length).toBe(1);
  const retained = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith("zyon:chat:v2:")));
  expect(retained).toHaveLength(1); expect(retained[0][1]).toBe(f.messages[0]);
  f.allowRecovery();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeEnabled();
  expect(f.messages).toHaveLength(1);
  await expect(page.getByText("Esta é a resposta que ficou salva.", { exact: true })).toHaveCount(1);
});

test("unresolved recovery stops after six attempts without payment fallbacks or buyer actions", async ({ page }) => {
  await page.clock.install();
  const f = await setup(page, "light", true);
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Vamos prosseguir"); await input.press("Enter");
  await expect.poll(() => f.calls.filter(path => path === "/embed/chat/reconcile").length).toBe(1);
  for (const [i, delay] of [1_000, 3_000, 7_000, 15_000, 30_000].entries()) {
    await page.clock.runFor(delay + 100);
    await expect.poll(() => f.calls.filter(path => path === "/embed/chat/reconcile").length).toBe(i + 2);
  }
  await expect(page.getByText("O chat está temporariamente indisponível. Tente mais tarde.", { exact: true })).toBeVisible();
  await page.clock.runFor(60_000);
  expect(f.calls.filter(path => path === "/embed/chat/reconcile")).toHaveLength(6);
  await expect(page.getByRole("button", { name: /Verificar conversa|Tentar novamente/ })).toHaveCount(0);
  await expect(input).toBeDisabled();
  expect(f.messages).toHaveLength(1);
  expect(f.calls.some(path => /payment|shipping|offers/.test(path))).toBe(false);
});

test("recovery waits for connectivity and resumes without another buyer action", async ({ page, context }) => {
  const f = await setup(page, "light", true);
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pode explicar esta etapa?"); await input.press("Enter");
  await expect.poll(() => f.calls.filter(path => path === "/embed/chat/reconcile").length).toBe(1);
  await context.setOffline(true);
  await expect(page.getByText("Sem conexão. O chat será retomado quando a internet voltar.", { exact: true })).toBeVisible();
  const count = f.calls.length;
  await page.clock.install(); await page.clock.runFor(60_000);
  expect(f.calls).toHaveLength(count);
  f.allowRecovery(); await context.setOffline(false);
  await page.clock.runFor(1_100);
  await expect(input).toBeEnabled();
  expect(f.messages).toHaveLength(1);
  await expect(page.getByText("Esta é a resposta que ficou salva.", { exact: true })).toHaveCount(1);
});

test("hidden or closed chat stops scheduled recovery traffic", async ({ page }) => {
  await page.clock.install();
  const f = await setup(page, "light", true);
  const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await input.fill("Pode explicar esta etapa?"); await input.press("Enter");
  await expect.poll(() => f.calls.filter(path => path === "/embed/chat/reconcile").length).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenCount = f.calls.length;
  await page.clock.runFor(60_000);
  expect(f.calls).toHaveLength(hiddenCount);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1_100);
  await expect.poll(() => f.calls.filter(path => path === "/embed/chat/reconcile").length).toBe(2);
  await page.evaluate(async () => {
    const { useCheckoutStore } = await import("/src/store/checkout-store.ts");
    useCheckoutStore.getState().resetSession();
  });
  await expect(input).toHaveCount(0);
  const closedCount = f.calls.length;
  await page.clock.runFor(60_000);
  expect(f.calls).toHaveLength(closedCount);
  expect(f.messages).toHaveLength(1);
});
