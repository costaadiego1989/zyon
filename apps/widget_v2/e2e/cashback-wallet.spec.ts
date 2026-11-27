import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const evidence = fileURLToPath(new URL("../../../.specs/features/cashback/evidence/", import.meta.url));
mkdirSync(evidence, { recursive: true });
const wallet = { merchantId: "merchant", buyerId: "buyer", currency: "BRL", balance: {
  availableCents: 3000, pendingCents: 1000, reservedCents: 500, earnedCents: 4500, usedCents: 0, expiredCents: 0, reversedCents: 0, lossCents: 0,
  nextExpiryAt: "2027-01-30T23:59:59-03:00", nextExpiryCents: 2000,
}, program: { status: "active", version: 1, published: { terms: "Saldo único nesta loja para site e WhatsApp." } } };
async function seed(page: Page) {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: "buyer", exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem("zyon_buyer_token", `e30.${payload}.test`);
  });
  await page.route("**/buyer/me/channels/whatsapp", route => route.fulfill({ json: { linked: false, phone: null } }));
  await page.route("**/buyer/me/cashback/transactions**", route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get("page"));
    expect(new URL(route.request().url()).searchParams.get("merchant_id")).toBe("merchant");
    expect(route.request().headers().authorization).toContain("Bearer ");
    return route.fulfill({ json: { items: [{ id: `tx-${pageNumber}`, merchantId: "merchant", buyerId: "buyer", type: "grant", amountCents: 1000,
      reason: pageNumber === 1 ? "Compra pelo WhatsApp" : "Compra pelo site", orderId: `order-${pageNumber}`, sessionId: null, actorId: null, occurredAt: "2026-11-14T12:00:00Z" }], total: 11, page: pageNumber, pageSize: 10 } });
  });
  await page.route(/\/buyer\/me\/cashback\?/, route => route.fulfill({ json: wallet }));
}

for (const width of [1440, 390]) {
  test(`CB-20 unified wallet and paged statement without behavioral consent at ${width}px (mocked API)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await seed(page);
    let memoryRequests = 0;
    await page.route("**/buyer/me/benefits**", route => { memoryRequests++; return route.fulfill({ status: 403 }); });
    await page.goto("/e2e/fixtures/cashback-wallet.html");
    const region = page.getByRole("region", { name: "Seu cashback nesta loja" });
    await expect(region.getByText("R$ 30,00", { exact: true })).toBeVisible();
    await expect(region.getByText("R$ 10,00", { exact: true }).first()).toBeVisible();
    await expect(region.getByText("R$ 5,00", { exact: true })).toBeVisible();
    await expect(region.getByText("Compra pelo WhatsApp", { exact: true })).toBeVisible();
    await region.getByText("Condições do cashback", { exact: true }).click();
    await expect(region.getByText("Saldo único nesta loja para site e WhatsApp.", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/buyer-cashback-${width}.png`, fullPage: true, animations: "disabled" });
    await region.getByRole("button", { name: "Próxima", exact: true }).click();
    await expect(region.getByText("Compra pelo site", { exact: true })).toBeVisible();
    await expect(region.getByText("Página 2 de 2", { exact: true })).toBeVisible();
    expect(memoryRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("CB-21 wallet loading failure is recoverable with a real retry gesture (mocked API)", async ({ page }) => {
  await seed(page); let calls = 0;
  await page.route(/\/buyer\/me\/cashback\?/, route => {
    calls++; return calls === 1 ? route.fulfill({ status: 503, json: { message: "unavailable" } }) : route.fulfill({ json: wallet });
  });
  await page.goto("/e2e/fixtures/cashback-wallet.html");
  await expect(page.getByRole("alert")).toContainText("Não foi possível consultar seu cashback");
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByText("R$ 30,00", { exact: true })).toBeVisible();
  expect(calls).toBe(2);
});

test("CB-20 buyer links WhatsApp to the existing account with explicit code confirmation (mocked API)", async ({ page }) => {
  await seed(page);
  let codeRequests = 0, verificationRequests = 0;
  await page.route("**/buyer/me/channels/whatsapp/code", route => {
    codeRequests++; expect(route.request().postDataJSON()).toEqual({ phone: "+5511999991234" });
    expect(route.request().headers().authorization).toContain("Bearer ");
    return route.fulfill({ json: { sent: true, delivered_to: "+5511999991234" } });
  });
  await page.route("**/buyer/me/channels/whatsapp/verify", route => {
    verificationRequests++; expect(route.request().postDataJSON()).toEqual({ phone: "+5511999991234", code: "012345" });
    return route.fulfill({ json: { linked: true, phone: "+5511999991234" } });
  });
  await page.goto("/e2e/fixtures/cashback-wallet.html");
  const channel = page.getByRole("region", { name: "Mesma conta no WhatsApp" });
  await channel.getByLabel("Número do WhatsApp").fill("+55 11 99999-1234");
  expect(codeRequests).toBe(0);
  await channel.getByRole("button", { name: "Enviar código", exact: true }).click();
  await expect(channel.getByLabel("Código de seis dígitos")).toBeVisible();
  expect(verificationRequests).toBe(0);
  await channel.getByLabel("Código de seis dígitos").fill("012345");
  await channel.getByRole("button", { name: "Confirmar WhatsApp", exact: true }).click();
  await expect(channel.getByText("WhatsApp vinculado", { exact: true })).toBeVisible();
  expect(codeRequests).toBe(1); expect(verificationRequests).toBe(1);
  await expect(channel).not.toContainText("+5511999991234");
  await expect(page.getByText("R$ 30,00", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/buyer-whatsapp-linked.png`, fullPage: true, animations: "disabled" });
});

test("CB-20 a buyer without a merchant binding can link WhatsApp and automatically recover the existing wallet (mocked API)", async ({ page }) => {
  await seed(page);
  let linked = false, walletRequests = 0, statementRequests = 0;
  await page.route(/\/buyer\/me\/cashback\?/, route => {
    walletRequests++;
    return linked ? route.fulfill({ json: wallet }) : route.fulfill({ status: 403, json: { message: "cashback_buyer_scope_required" } });
  });
  await page.route("**/buyer/me/cashback/transactions**", route => {
    statementRequests++;
    return linked ? route.fulfill({ json: { items: [{ id: "existing-wa-credit", merchantId: "merchant", buyerId: "buyer", type: "grant", amountCents: 3000,
      reason: "Crédito já ganho pelo WhatsApp", orderId: "existing-wa-order", sessionId: null, actorId: null, occurredAt: "2026-11-14T12:00:00Z" }], total: 1, page: 1, pageSize: 10 } })
      : route.fulfill({ status: 403, json: { message: "cashback_buyer_scope_required" } });
  });
  await page.route("**/buyer/me/channels/whatsapp/code", route => route.fulfill({ json: { sent: true, delivered_to: "+5511999991234" } }));
  await page.route("**/buyer/me/channels/whatsapp/verify", route => {
    expect(route.request().postDataJSON()).toEqual({ phone: "+5511999991234", code: "012345" });
    linked = true; return route.fulfill({ json: { linked: true, phone: "+5511999991234" } });
  });
  await page.goto("/e2e/fixtures/cashback-wallet.html");
  await expect(page.getByRole("alert")).toContainText("Não foi possível consultar seu cashback");
  const channel = page.getByRole("region", { name: "Mesma conta no WhatsApp" });
  await expect(channel.getByLabel("Número do WhatsApp")).toBeVisible();
  await expect(page.getByText("R$ 30,00", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/buyer-whatsapp-before-wallet-link.png`, fullPage: true, animations: "disabled" });
  await channel.getByLabel("Número do WhatsApp").fill("+55 11 99999-1234");
  await channel.getByRole("button", { name: "Enviar código", exact: true }).click();
  await channel.getByLabel("Código de seis dígitos").fill("012345");
  await channel.getByRole("button", { name: "Confirmar WhatsApp", exact: true }).click();
  await expect(channel.getByText("WhatsApp vinculado", { exact: true })).toBeVisible();
  await expect(page.locator("dl").getByText("R$ 30,00", { exact: true })).toBeVisible();
  await expect(page.getByText("Crédito já ganho pelo WhatsApp", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(walletRequests).toBeGreaterThanOrEqual(2); expect(statementRequests).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: `${evidence}/buyer-whatsapp-recovered-wallet.png`, fullPage: true, animations: "disabled" });
});
