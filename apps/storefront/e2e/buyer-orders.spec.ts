import { test, expect, type Page, type Route } from "@playwright/test";
import type { BuyerPurchase } from "../src/lib/viewmodels/useBuyerHub/types";

// Local synthetic UI/API fixtures. These tests do not verify real purchases or payments.
const physical: BuyerPurchase = {
  id: "purchase-physical", order_id: "order-physical", merchant_name: "Athom", has_tracking: true,
  tracking_code: "AB123456789BR", tracking_status: "delivered", carrier: "correios",
  total: 245, discount_amount: 15, currency: "BRL", created_at: "2026-10-02T12:00:00Z", payment_method: "pix",
  items: [{ name: "Luminária de mesa", quantity: 2, unit_price: 120 }, { name: "Manual digital de iluminação", quantity: 1, unit_price: 20 }],
  items_count: 2,
};
const digital: BuyerPurchase = {
  ...physical, id: "purchase-digital", order_id: "order-digital", has_tracking: false,
  tracking_code: "pending:fc248e0c-329c-4584-ad3b-96f98a5b0367", carrier: "flat-rate", tracking_status: null,
  items: [{ name: "Curso digital de fotografia", quantity: 1, unit_price: 89.9 }], items_count: 1,
  total: 89.9, discount_amount: 0, payment_method: "credit_card",
};
const brl = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

async function setup(page: Page, purchases: BuyerPurchase[], theme: "light" | "dark" = "light", response?: (route: Route) => Promise<void>) {
  await page.addInitScript((mode) => {
    localStorage.setItem("zyon_buyer_token", "e30." + btoa(JSON.stringify({ sub: "orders-buyer", email: "qa@example.invalid", exp: 4102444800 })) + ".local-fixture");
    localStorage.setItem("zyon-theme", mode);
  }, theme);
  await page.route("**/api/buyer/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/purchases")) {
      return response ? response(route) : route.fulfill({ json: { items: purchases, next_cursor: null } });
    }
    return route.fulfill({ json: { global_user_id: "orders-buyer", display_name: "Conta de teste", items: [] } });
  });
}

async function openOrders(page: Page) {
  await page.goto("/?hub=1");
  await page.getByRole("tab", { name: "Pedidos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Seus pedidos", exact: true })).toBeVisible();
  return page.getByRole("tabpanel", { name: "Pedidos", exact: true });
}

test("all purchased items remain visible including digital; amounts and payment use actual order data", async ({ page }) => {
  await setup(page, [physical, digital]);
  const panel = await openOrders(page);
  const orders = panel.getByRole("article");
  await expect(orders).toHaveCount(2);
  const mixed = orders.first();
  await expect(mixed.getByRole("list", { name: "Itens do pedido", exact: true }).getByRole("listitem")).toHaveCount(2);
  await expect(mixed.getByText("2 × Luminária de mesa", { exact: true })).toBeVisible();
  await expect(mixed.getByText(brl(120) + " por unidade", { exact: true })).toBeVisible();
  await expect(mixed.getByText(brl(240), { exact: true })).toBeVisible();
  await expect(mixed.getByText(brl(245), { exact: true })).toBeVisible();
  await expect(mixed.getByText("−" + brl(15), { exact: true })).toBeVisible();
  await expect(mixed.getByText("Pix", { exact: true })).toBeVisible();
  await expect(mixed.locator("time")).toHaveAttribute("datetime", "2026-10-02T12:00:00.000Z");
  await expect(orders.last().getByText("1 × Curso digital de fotografia", { exact: true })).toBeVisible();
  await expect(orders.last().getByText("Cartão de crédito", { exact: true })).toBeVisible();
  await expect(orders.last().getByText("Desconto", { exact: true })).toHaveCount(0);
  await expect(panel).not.toContainText(/Sem status|pending:|flat-rate|AB123456789BR|Entregue|Pago|Confirmado|purchase-physical|order-physical/);
});

test("long orders reveal remaining items with keyboard without hiding their real quantities or prices", async ({ page }) => {
  await setup(page, [{ ...physical, items: [...physical.items, { name: "Cabo USB-C", quantity: 1, unit_price: 30 },
    { name: "Livro digital", quantity: 2, unit_price: 10 }, { name: "Adaptador", quantity: 3, unit_price: 8 }], items_count: 5 }]);
  const panel = await openOrders(page);
  await expect(panel.getByRole("list", { name: "Itens do pedido", exact: true }).getByRole("listitem")).toHaveCount(3);
  const expand = panel.locator("summary").filter({ hasText: "Ver mais 2 itens" });
  await expand.focus();
  await page.keyboard.press("Enter");
  const additional = panel.getByRole("list", { name: "Demais itens do pedido", exact: true });
  await expect(additional.getByRole("listitem")).toHaveCount(2);
  await expect(additional.getByText("2 × Livro digital", { exact: true })).toBeVisible();
  await expect(additional.getByText(brl(20), { exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(additional).not.toBeVisible();
});

test("missing information is explicit and never converted to zero, technical labels or a payment status", async ({ page }) => {
  await setup(page, [{ ...digital, merchant_name: "fc248e0c-329c-4584-ad3b-96f98a5b0367", created_at: "invalid_date",
    total: Number.NaN, payment_method: "psp_internal_v3", discount_amount: -15,
    items: [{ name: "Livro digital", quantity: 0, unit_price: Number.NaN }] }]);
  const panel = await openOrders(page);
  const order = panel.getByRole("article", { name: "Pedido de Loja", exact: true });
  await expect(order.getByRole("heading", { name: "Loja", exact: true })).toBeVisible();
  await expect(order.getByText("Data indisponível", { exact: true })).toBeVisible();
  await expect(order.getByText("Quantidade indisponível", { exact: true })).toBeVisible();
  await expect(order.getByText("Valor indisponível", { exact: true })).toHaveCount(2);
  await expect(order.getByText("Não informada", { exact: true })).toBeVisible();
  await expect(order).not.toContainText(/fc248e0c|psp_internal|invalid_date|NaN|R\$\s*0,00|Desconto|Sem status/);
});

test("loading does not flash an empty result and an empty response has a truthful state", async ({ page }) => {
  let release = () => {};
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, [], "light", async (route) => { await wait; await route.fulfill({ json: { items: [], next_cursor: null } }); });
  const panel = await openOrders(page);
  await expect(panel.getByRole("status", { name: "Carregando seus pedidos", exact: true })).toBeVisible();
  await expect(panel.getByText("Nenhum pedido por aqui", { exact: true })).toHaveCount(0);
  release();
  await expect(panel.getByText("Nenhum pedido por aqui", { exact: true })).toBeVisible();
  await expect(panel.getByRole("article")).toHaveCount(0);
});

test("initial errors have a working retry and never expose a technical error", async ({ page }) => {
  let requests = 0;
  await setup(page, [], "light", async (route) => { requests += 1; await route.fulfill(requests === 1
    ? { status: 500, json: { message: "private_db_failure_identifier" } }
    : { json: { items: [digital], next_cursor: null } }); });
  const panel = await openOrders(page);
  await expect(panel.getByRole("alert")).toContainText("Não foi possível carregar seus pedidos.");
  await expect(panel).not.toContainText("private_db_failure_identifier");
  await panel.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(panel.getByRole("article")).toHaveCount(1);
  expect(requests).toBe(2);
});

test("next-page errors keep visible purchases and retry appends once, with disabled loading control", async ({ page }) => {
  let pageTwoRequests = 0;
  let release = () => {};
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await setup(page, [], "light", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor) { await route.fulfill({ json: { items: [physical], next_cursor: "page-two" } }); return; }
    pageTwoRequests += 1;
    if (pageTwoRequests === 1) { await route.fulfill({ status: 500, json: { message: "failure" } }); return; }
    await wait;
    await route.fulfill({ json: { items: [physical, digital], next_cursor: null } });
  });
  const panel = await openOrders(page);
  await panel.getByRole("button", { name: "Carregar mais pedidos", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Não foi possível carregar mais pedidos.");
  await expect(panel.getByRole("article")).toHaveCount(1);
  await panel.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Carregar mais pedidos", exact: true })).toBeDisabled();
  await expect(panel.getByRole("article")).toHaveCount(1);
  release();
  await expect(panel.getByRole("article")).toHaveCount(2);
  await expect(panel.getByRole("button", { name: "Carregar mais pedidos", exact: true })).toHaveCount(0);
  expect(pageTwoRequests).toBe(2);
});

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`orders panel remains readable at ${width}px ${theme}`, async ({ page }, info) => {
    info.annotations.push({ type: "scope", description: "Local synthetic UI/API fixture, not real purchase or payment proof." });
    await page.setViewportSize({ width, height: 900 });
    await setup(page, [physical, digital, { ...physical, id: "long-name", merchant_name: "Loja de acessórios e equipamentos para fotografia",
      items: [{ name: "Kit profissional com suporte articulado para iluminação e acessórios de montagem", quantity: 12, unit_price: 159.9 }], total: 1918.8, discount_amount: 0, payment_method: "boleto" }], theme);
    const panel = await openOrders(page);
    await expect(panel.getByRole("article")).toHaveCount(3);
    expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`orders-local-${theme}-${width}.png`), fullPage: true });
    await panel.getByRole("article").last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`orders-local-${theme}-${width}-long-name.png`), fullPage: true });
    expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  });
}
