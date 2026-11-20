import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import type { BuyerPurchase } from "../src/lib/viewmodels/useBuyerHub/types";

// Current published purchase cards, real buyer hub and protected document client.
// Local captured API only; no provider, purchase, payment or customer delivery.
const merchantId = "qa-store";
const orderId = "original/order";
const buyerToken = (subject: string) => `e30.${Buffer.from(JSON.stringify({ sub: subject, email: "qa@example.invalid", exp: 4102444800 })).toString("base64url")}.synthetic`;
const order: BuyerPurchase = {
  id: "target-purchase", order_id: orderId, merchant_id: merchantId, merchant_name: "Loja de teste",
  total: 245, discount_amount: 15, currency: "BRL", created_at: "2026-10-02T12:00:00Z", payment_method: "pix",
  items: [{ name: "Luminária de mesa", quantity: 2, unit_price: 120 }], items_count: 1,
};
const earlier = Array.from({ length: 10 }, (_, index) => ({ ...order, id: `purchase-${index}`, order_id: `earlier-${index}`, merchant_name: `Loja ${index}` }));
const note = {
  intentId: "original-intent", sellerMerchantId: merchantId, orderId, state: "authorized", documentState: "available",
  number: "123", series: "1", authorizationProtocol: "151260029467289", documents: [{ kind: "xml", available: true }],
};
const xml = Buffer.from('<nfeProc><NFe>synthetic-private-original</NFe></nfeProc>');
const deepLink = "/?hub=1&" + new URLSearchParams({ buyerHub: "orders", orderId, fiscalIntentId: note.intentId, fiscalEnvironment: "homologation", fiscalDocument: "xml" });

async function setup(page: Page, subject = "original-buyer") {
  const token = buyerToken(subject);
  await page.addInitScript(value => { localStorage.setItem("zyon_buyer_token", value); }, token);
  const calls = { lookups: [] as string[], metadata: [] as string[], downloads: [] as string[] };
  await page.route("**/api/buyer/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/purchases")) {
      const lookup = url.searchParams.get("limit") === "100";
      if (lookup) calls.lookups.push(url.search);
      const ownsOrder = request.headers().authorization === `Bearer ${buyerToken("original-buyer")}`;
      return route.fulfill({ json: !ownsOrder ? { items: [], next_cursor: null }
        : url.searchParams.has("cursor") ? { items: [order], next_cursor: null }
        : { items: earlier, next_cursor: "page-2" } });
    }
    if (url.pathname.endsWith("/fiscal")) {
      calls.metadata.push(request.headers().authorization);
      return route.fulfill({ json: { items: [note] } });
    }
    if (url.pathname.includes("/documents/xml")) {
      calls.downloads.push(request.headers().authorization);
      return route.fulfill({ body: xml, contentType: "application/xml" });
    }
    return route.fulfill({ json: { global_user_id: subject, display_name: "Conta de teste", items: [] } });
  });
  return calls;
}

for (const width of [390, 1440]) {
  test(`FISCAL-41/44 current orders card opens private note and toggles it without hiding purchase data ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await setup(page);
    await page.goto(deepLink);
    const panel = page.getByRole("tabpanel", { name: "Pedidos", exact: true });
    const documents = panel.getByRole("region", { name: `Notas fiscais do pedido ${orderId}`, exact: true });
    await expect(documents.getByText("Protocolo de autorização: 151260029467289", { exact: true })).toBeVisible();
    expect(calls.lookups).toEqual(["?limit=100&merchant_id=qa-store", "?limit=100&cursor=page-2&merchant_id=qa-store"]);
    const card = panel.getByRole("article", { name: "Pedido de Loja de teste", exact: true });
    await expect(card.getByText("2 × Luminária de mesa", { exact: true })).toBeVisible();
    await expect(card.getByText("Pix", { exact: true })).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await documents.getByRole("button", { name: "Baixar XML", exact: true }).click();
    const stream = await (await downloaded).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk);
    expect(createHash("sha256").update(Buffer.concat(chunks)).digest("hex")).toBe(createHash("sha256").update(xml).digest("hex"));
    expect(calls.downloads).toEqual([`Bearer ${buyerToken("original-buyer")}`]);
    await card.getByRole("button", { name: "Ocultar nota fiscal", exact: true }).click();
    await expect(documents).toHaveCount(0);
    await expect(card.getByText("2 × Luminária de mesa", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Ver nota fiscal", exact: true }).click();
    await expect(documents.getByText("Protocolo de autorização: 151260029467289", { exact: true })).toBeVisible();
    expect(calls.metadata).toEqual(Array(2).fill(`Bearer ${buyerToken("original-buyer")}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("FISCAL-42 current order lookup rejects a different buyer before any fiscal metadata or file", async ({ page }) => {
  const calls = await setup(page, "different-buyer");
  await page.goto(deepLink);
  const panel = page.getByRole("tabpanel", { name: "Pedidos", exact: true });
  await expect(panel.getByRole("alert")).toContainText("Pedido não encontrado nesta conta.");
  await expect(panel.getByRole("region", { name: `Notas fiscais do pedido ${orderId}`, exact: true })).toHaveCount(0);
  expect(calls.metadata).toEqual([]);
  expect(calls.downloads).toEqual([]);
});

test("FISCAL-44 changing the buyer removes the previous order and forbids a late private Blob download", async ({ page }) => {
  const calls = await setup(page);
  await page.goto(deepLink);
  const documents = page.getByRole("region", { name: `Notas fiscais do pedido ${orderId}`, exact: true });
  await expect(documents.getByText("Protocolo de autorização: 151260029467289", { exact: true })).toBeVisible();
  let release!: () => void, captured!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { captured = resolve; });
  await page.route("**/documents/xml?*", async route => {
    captured();
    await gate;
    await route.fulfill({ body: xml, contentType: "application/xml" }).catch(() => {});
  });
  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await documents.getByRole("button", { name: "Baixar XML", exact: true }).click();
  await ready;
  await page.evaluate(token => {
    localStorage.setItem("zyon_buyer_token", token);
    window.dispatchEvent(new StorageEvent("storage", { key: "zyon_buyer_token" }));
  }, buyerToken("different-buyer"));
  await expect(page.getByText("Pedido não encontrado nesta conta.", { exact: true })).toBeVisible();
  release();
  await expect(documents).toHaveCount(0);
  await expect(page.getByText("151260029467289", { exact: false })).toHaveCount(0);
  expect(downloads).toEqual([]);
  expect(calls.metadata).toEqual([`Bearer ${buyerToken("original-buyer")}`]);
});
