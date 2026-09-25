import { test, expect, type Page } from "@playwright/test";

const widgetUrl = process.env.WIDGET_RECOVERY_TEST_URL ?? "http://127.0.0.1:5174";

async function setup(page: Page, theme = "light", unavailable = false) {
  let currentId = "", recovered = false;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const messages: string[] = [], calls: string[] = [];
  const state = () => ({ protocol: "durable_v2", session_id: "bound-session", conversation_id: "conversation-real",
    turns: currentId ? [
      { id: "saved:buyer", role: "buyer", text: "Pode explicar esta etapa?", occurred_at: "2026-09-25T02:00:00.000Z" },
      { id: "saved:agent", role: "agent", text: "Esta é a resposta que ficou salva.", occurred_at: "2026-09-25T02:00:00.000Z" },
    ] : [],
    ...(currentId ? { request: { message_id: currentId, status: recovered ? "reconciled" : "unknown" } } : {}),
    ...(currentId && !recovered ? { active_request: { message_id: currentId, status: "unknown" } } : {}),
  });
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.fallback() : route.abort());
  await page.route("**/embed/**", async route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/embed/start") return json({ session_id: "bound-session", conversation_id: "conversation-real", chat_protocol: "durable_v2",
      experience: { brand: { name: "Loja de teste", theme: { mode: theme } }, agent: { name: "Assistente" },
        items: [{ sku: "P1", name: "Produto de teste", unit_price: 99.9, quantity: 1 }], totals: { subtotal: 99.9, total: 99.9 }, rules: { showBranding: false } } });
    if (path === "/embed/chat/state") return json(state());
    if (path === "/embed/chat") {
      const body = route.request().postDataJSON();
      expect(body.conversation_id).toBe("conversation-real");
      expect(body.message_id).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
      messages.push(body.message_id);
      if (recovered) return json({ message: "Podemos continuar.", stage: "customer_data", missing_fields: [], chat_request: { message_id: body.message_id, status: "completed" } });
      currentId = body.message_id;
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
  return { messages, calls, allowRecovery: () => { unavailable = false; release(); } };
}

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
