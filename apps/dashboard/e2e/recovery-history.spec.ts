import { test, expect } from "@playwright/test";
const at = "2026-11-27T18:00:00.000Z";
const attempt = { id: "rec_test", session_id: "checkout-test", strategy: "personalized_cross_sell", status: "sent", channel: "whatsapp_template", created_at: at, sent_at: at,
  customer: { name: "Ana Silva", email: "ana@example.test", phone: "+5511999991111" }, contact_source: "send_snapshot", recipient: "+5511999991111", delivery_status: "read", read_at: at };
test.beforeEach(async ({ page }) => {
  await page.route("**/v1/dashboard/cart-recovery/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attempts/rec_test")) return route.fulfill({ json: { ...attempt, reason: null, fallback_reason: null, recovered_at: null, recovered_order_id: null, last_activity_at: at,
      messages: [{ id: "message-1", correlation_id: "rec_test", channel: "whatsapp_template", status: "read", recipient: "+5511999991111", body: "Olá, Ana! Seu carrinho está esperando.\nhttps://example.test/carrinho", template: "cart_v1", created_at: at, sent_at: at, delivered_at: null, read_at: at, failed_at: null, provider_message_id: "wamid.fixture" }],
      follow_ups: [{ id: "reminder-1", step: 1, due_at: at, status: "pending" }], } });
    const filter = url.searchParams.get("channel"), offset = Number(url.searchParams.get("offset") ?? 0);
    return route.fulfill({ json: { total: filter ? 0 : 12, data: filter ? [] : Array.from({ length: offset ? 2 : 10 }, (_, i) => ({ ...attempt, id: i === 0 && !offset ? "rec_test" : `rec_${offset + i}`, customer: { ...attempt.customer, name: offset ? `Cliente página 2 ${i}` : i ? `Cliente ${i}` : "Ana Silva" } })) } });
  });
});
test("recipient, read receipt, timeline and keyboard drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/e2e/recovery-history.html");
  await expect(page.getByText("ana@example.test").first()).toBeVisible();
  await page.getByRole("button", { name: "Ana Silva", exact: true }).focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await expect(dialog.getByText("(11) 99999-1111", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("+5511999991111", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Destinatário no envio")).toBeVisible();
  await expect(dialog.getByText("Confirmada pela leitura")).toBeVisible();
  await expect(dialog.getByText("Lembrete 1", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/recovery-detail-desktop.png", fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Ana Silva", exact: true })).toBeFocused();
});
test("server pagination and filters remain usable with zero matches", async ({ page }) => {
  await page.goto("/e2e/recovery-history.html");
  await expect(page.getByText("1–10 de 12")).toBeVisible();
  await page.getByRole("button", { name: /próxima/i }).click();
  await expect(page.getByRole("button", { name: "Cliente página 2 0", exact: true })).toBeVisible();
  await page.getByLabel("Canal", { exact: true }).selectOption("email");
  await expect(page.getByText(/Nenhuma tentativa encontrada/)).toBeVisible();
  await page.getByLabel("Canal", { exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "Ana Silva", exact: true })).toBeVisible();
});
test("mobile drawer fits and historical gaps stay explicit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/recovery-history.html");
  await page.getByRole("button", { name: "Ana Silva", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/recovery-detail-mobile.png", fullPage: true, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.route("**/v1/dashboard/cart-recovery/attempts/rec_test", route => route.fulfill({ json: { ...attempt, messages: [], follow_ups: [], last_activity_at: null } }));
  await page.getByRole("button", { name: "Ana Silva", exact: true }).click();
  await expect(page.getByText(/Esta tentativa é anterior ao histórico detalhado/)).toBeVisible();
});
