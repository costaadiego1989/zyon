import { expect, test, type Page } from "@playwright/test";

function conversation(id: string, status = "history", merchantId = "store-1") {
  return { id, session_id: id, merchant_id: merchantId, merchant_name: "Athom", status,
    started_at: "2026-10-05T10:00:00Z", last_message_at: "2026-10-05T11:00:00Z",
    messages: [{ id: `${id}-buyer`, role: "buyer", content: id === "current" ? "Quero conhecer as ofertas" : `Conversa sobre ${id}`, created_at: "2026-10-05T10:00:00Z" },
      { id: `${id}-agent`, role: "agent", content: "Posso ajudar com os produtos da loja.", created_at: "2026-10-05T10:01:00Z" }] };
}
async function setup(page: Page, options: { detailStatus?: string; listStatus?: string; fail?: boolean; delay?: number } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("zyon_buyer_token", `header.${btoa(JSON.stringify({ sub: "buyer-1", exp: Date.now() / 1000 + 3600 }))}.signature`);
    // Legacy unscoped support data must never appear in authenticated history.
    sessionStorage.setItem("zyon_support_messages", JSON.stringify([{ text: "Private support from another store" }]));
  });
  await page.route("**/api/buyer/me**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/buyer/me/conversations") {
      if (options.delay) await new Promise((resolve) => setTimeout(resolve, options.delay));
      if (options.fail) return route.fulfill({ status: 503, json: { message: "unavailable" } });
      const items = url.searchParams.get("merchant_id") === "store-2" ? [] : [conversation("paid", "completed"), conversation("current", options.listStatus || "in_progress"), conversation("expired", "expired"), conversation("legacy"), conversation("foreign", "in_progress", "store-2")];
      return route.fulfill({ json: { items } });
    }
    if (url.pathname === "/api/buyer/me/conversations/current") return route.fulfill({ json: conversation("current", options.detailStatus || "in_progress") });
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
}

for (const width of [390, 1440]) test(`readable compact conversation rows and current resume at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setup(page);
  const rows = page.locator(".buyer-conversation-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("Quero conhecer as ofertas");
  await expect(rows.first()).toContainText("Em andamento");
  await expect(page.getByText("Finalizada", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Histórico", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Continuar conversa" })).toHaveCount(1);
  await expect(page.getByText("Private support from another store")).toHaveCount(0);
  await expect(page.getByText("store-1", { exact: true })).toHaveCount(0);
  await rows.first().getByRole("button", { name: "Ver mensagens" }).click();
  await expect(rows.first().getByLabel("Remetente: Você")).toBeVisible();
  await expect(rows.first().getByRole("region")).toBeVisible();
  await rows.first().getByRole("button", { name: "Ocultar mensagens" }).click();
  await expect(rows.first().getByRole("region")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bounds = await rows.first().boundingBox();
  expect(bounds!.height).toBeLessThan(190);
  await page.screenshot({ path: test.info().outputPath(`conversations-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "Continuar conversa" }).click();
  await expect(page.getByRole("region", { name: "Chat atual" })).toBeVisible();
  await expect(page.getByText("Mensagem preservada no atendimento atual")).toBeVisible();
});

test("completed current conversation only offers history", async ({ page }) => {
  await setup(page, { listStatus: "completed" });
  await expect(page.locator(".buyer-conversation-row")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Continuar conversa" })).toHaveCount(0);
  await page.locator(".buyer-conversation-row").first().getByRole("button", { name: "Ver mensagens" }).click();
  await expect(page.getByText("A compra desta conversa foi encerrada. As mensagens continuam disponíveis para consulta.")).toBeVisible();
});

test("stale active status is revalidated before resume; a completed purchase stays closed", async ({ page }) => {
  await setup(page, { detailStatus: "completed" });
  await page.getByRole("button", { name: "Continuar conversa" }).click();
  await expect(page.getByRole("alert")).toContainText("Não foi possível retomar");
  await expect(page.getByRole("region", { name: "Chat atual" })).toHaveCount(0);
});

test("switching shops and signing out never retain the prior account's conversation list", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".buyer-conversation-row")).toHaveCount(4);
  await page.getByRole("button", { name: "Outra loja" }).click();
  await expect(page.getByText("Nenhuma conversa salva")).toBeVisible();
  await expect(page.locator(".buyer-conversation-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page.getByRole("region", { name: "Histórico de conversas" })).toHaveCount(0);
});

test("failed history fetch is explicit and can be retried", async ({ page }) => {
  await setup(page, { fail: true });
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar suas conversas");
  await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  await expect(page.getByText("Nenhuma conversa salva")).toHaveCount(0);
});

test("a response arriving after logout cannot repopulate history", async ({ page }) => {
  await setup(page, { delay: 700 });
  await expect(page.getByText("Carregando conversas…")).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.waitForTimeout(850);
  await expect(page.locator(".buyer-conversation-row")).toHaveCount(0);
});
