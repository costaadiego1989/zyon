import { expect, test, type Page } from "@playwright/test";
async function setup(page: Page, options: { readFails?: boolean; delay?: number } = {}) {
  const messages = [{ id: "initial", ticketId: "ticket-1", senderType: "buyer", content: "Preciso de ajuda", createdAt: "2026-10-17T10:00:00Z" },
    { id: "reply", ticketId: "ticket-1", senderType: "merchant", content: "Vou ajudar você a encontrar o produto.", createdAt: "2026-10-17T10:01:00Z" }];
  let unread = 2; const reads: string[] = [], sends: { content: string; clientMessageId: string }[] = [];
  await page.addInitScript(() => localStorage.setItem("zyon_buyer_token", `header.${btoa(JSON.stringify({ sub: "fixture", exp: Date.now() / 1000 + 3600 }))}.signature`));
  const ticket = () => ({ ticketId: "ticket-1", merchantId: "store-1", kind: "support", status: "in_progress", active: true, unreadCount: unread, updatedAt: messages.at(-1)!.createdAt, lastMessage: messages.at(-1) });
  await page.route("**/api/buyer/support/tickets**", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname.endsWith("/read")) {
      reads.push(req.postDataJSON().lastMessageId);
      if (options.readFails) return route.fulfill({ status: 503, json: {} });
      unread = 0; return route.fulfill({ json: { success: true } });
    }
    if (url.pathname.endsWith("/messages")) {
      const body = req.postDataJSON(); sends.push(body);
      if (sends.length === 1) return route.fulfill({ status: 503, json: {} });
      const message = { id: "sent", ticketId: "ticket-1", senderType: "buyer", content: body.content, createdAt: "2026-10-17T10:02:00Z" }; messages.push(message);
      return route.fulfill({ json: message });
    }
    if (url.pathname.endsWith("/ticket-1")) return route.fulfill({ json: { ...ticket(), messages: url.searchParams.has("cursor") ? messages.filter(m => m.id === "sent") : messages, nextCursor: null } });
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    return route.fulfill({ json: { items: url.searchParams.get("merchantId") === "store-1" ? [ticket()] : [], unreadCount: unread } });
  });
  await page.goto("/");
  return { reads, sends };
}
for (const width of [390, 1440]) test(`one badge per unread conversation, reading clears it at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await setup(page);
  const trigger = page.getByRole("button", { name: "Abrir conta, 1 conversa não lida", exact: true });
  await expect(trigger).toBeVisible(); await expect(trigger).toHaveText("1");
  await trigger.click(); await expect(page.getByText("1 nova", { exact: true })).toBeVisible();
  expect(state.reads).toEqual([]);
  await page.getByRole("button", { name: /Abrir atendimento/ }).click();
  await expect(page.getByRole("log")).toContainText("Vou ajudar você");
  await expect(page.getByRole("button", { name: "Abrir conta", exact: true })).toBeVisible();
  expect(state.reads).toContain("reply");
  await page.getByRole("textbox", { name: "Sua mensagem para a loja" }).fill("Obrigado pela ajuda.");
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Seu texto foi mantido");
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Obrigado pela ajuda.");
  expect(state.sends[0].clientMessageId).toBe(state.sends[1].clientMessageId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("failed read acknowledgement keeps the unread badge", async ({ page }) => {
  await setup(page, { readFails: true });
  await page.getByRole("button", { name: /Abrir conta, 1 conversa/ }).click();
  await page.getByRole("button", { name: /Abrir atendimento/ }).click();
  await expect(page.getByRole("log")).toContainText("Vou ajudar você");
  await expect(page.getByRole("button", { name: /Abrir conta, 1 conversa/ })).toBeVisible();
});
test("changing merchant and logging out clear private support and late responses", async ({ page }) => {
  await setup(page, { delay: 500 });
  await page.getByRole("button", { name: /Abrir conta, 1 conversa/ }).click();
  await page.getByRole("button", { name: "Outra loja" }).click();
  await expect(page.getByRole("button", { name: /Abrir atendimento/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.waitForTimeout(700);
  await expect(page.getByRole("button", { name: /Abrir atendimento/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Abrir conta", exact: true })).toBeVisible();
});
