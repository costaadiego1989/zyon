import { test, expect } from "@playwright/test";

test("VERIFIER CB-20 a website account can link existing WhatsApp credit before it has a merchant wallet", async ({ page }) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ sub: "new-website-account", exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem("zyon_buyer_token", `e30.${payload}.test`);
  });
  let linked = false;
  await page.route("**/buyer/me/channels/whatsapp", route => route.fulfill({ json: { linked, phone: linked ? "***1234" : null } }));
  await page.route("**/buyer/me/channels/whatsapp/code", route => route.fulfill({ json: { sent: true, delivered_to: "***1234" } }));
  await page.route("**/buyer/me/channels/whatsapp/verify", route => { linked = true; return route.fulfill({ json: { linked: true, phone: "***1234" } }); });
  await page.route(/\/buyer\/me\/cashback\?/, route => linked ? route.fulfill({ json: {
    merchantId: "merchant", buyerId: "new-website-account", currency: "BRL",
    balance: { availableCents: 3179, pendingCents: 0, reservedCents: 0, earnedCents: 3179, usedCents: 0, expiredCents: 0, reversedCents: 0, lossCents: 0, nextExpiryAt: null, nextExpiryCents: 0 },
    program: { status: "active", version: 1, published: { terms: "Crédito para usar nesta mesma loja." } },
  } }) : route.fulfill({ status: 403, json: { message: "cashback_merchant_binding_required" } }));
  await page.route("**/buyer/me/cashback/transactions**", route => linked ? route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } })
    : route.fulfill({ status: 403, json: { message: "cashback_merchant_binding_required" } }));
  await page.goto("/e2e/fixtures/cashback-wallet.html");
  const channel = page.getByRole("region", { name: "Mesma conta no WhatsApp" });
  await expect(channel).toBeVisible();
  await channel.getByLabel("Número do WhatsApp").fill("+5511999991234");
  await channel.getByRole("button", { name: "Enviar código", exact: true }).click();
  await channel.getByLabel("Código de seis dígitos").fill("012345");
  await channel.getByRole("button", { name: "Confirmar WhatsApp", exact: true }).click();
  await expect(channel.getByText("WhatsApp vinculado", { exact: true })).toBeVisible();
  await expect(page.getByText("R$ 31,79", { exact: true })).toBeVisible();
});
