import { test, expect, type Page, type Route } from "@playwright/test";
import { currentPersonalizedOffers } from "../src/lib/personalized-offers";
import type { BuyerPersonalizedOffer } from "../src/lib/viewmodels/useBuyerHub/types";

// Local component/HTTP fixtures. These tests do not claim real enrollment or payment proof.
const expiry = "2099-10-06T12:30:00.000Z";
const offer: BuyerPersonalizedOffer = { id: "assigned-only", kind: "percentage", name: "Desconto", description: "",
  currency: "BRL", amountCents: 500, maxDiscountCents: 1200, discountPercent: 5, deliveryMode: "automatic",
  sessionId: "checkout-current", expiresAt: expiry, condition: "Sujeito às condições desta compra.", status: "applied" };
const benefits = (offers?: BuyerPersonalizedOffer[]) => ({ available: [], earned: [], progress: [], ...(offers ? { offers } : {}) });
async function seed(page: Page) {
  await page.addInitScript(() => {
    const token = "e30." + btoa(JSON.stringify({ sub: "qa-buyer", exp: 4102444800 })) + ".local-fixture";
    localStorage.setItem("zyon_buyer_token", token);
    localStorage.setItem("zyon-theme", "light");
  });
  await page.route("**/api/buyer/**", (route) => route.fulfill({ json: route.request().url().endsWith("/loyalty")
    ? { total_orders: 0, total_spent_cents: 0, avg_order_value_cents: 0, top_categories: [], preferred_brands: [] }
    : route.request().url().endsWith("/summary") ? { orders_count: 0, total_spent: 0, average_ticket: 0, currency: "BRL" }
    : { global_user_id: "qa-buyer", display_name: "Conta de teste", items: [] } }));
}
async function open(page: Page) { await page.goto("/"); await page.getByRole("button", { name: "Fidelidade", exact: true }).click(); }

test("excludes absent, expired, invalid and other-session offers without calculating new entitlements", () => {
  expect(currentPersonalizedOffers(undefined)).toEqual([]);
  expect(currentPersonalizedOffers([offer], Date.now(), "another-checkout")).toEqual([]);
  expect(currentPersonalizedOffers([offer], Date.parse(expiry))).toEqual([]);
  for (const patch of [{ status: "reserved" }, { amountCents: 0 }, { amountCents: 1201 }, { discountPercent: 0 },
    { discountPercent: Infinity }, { currency: "USD" }, { kind: "unknown" }, { sessionId: "" }, { expiresAt: "bad" },
    { deliveryMode: "public" }, { deliveryMode: "coupon_code" }]) {
    expect(currentPersonalizedOffers([{ ...offer, ...patch }])).toEqual([]);
  }
  expect(currentPersonalizedOffers([offer], Date.now(), offer.sessionId)).toEqual([offer]);
});

for (const width of [390, 1440]) test(`shows exact applied discount, caps, expiry and personalized coupon at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await seed(page);
  const all = [offer, { ...offer, id: "coupon", kind: "fixed" as const, maxDiscountCents: 500,
    deliveryMode: "coupon_code" as const, couponCode: "ZYON612FFE43FD5D41A682E3" },
    { ...offer, id: "shipping", kind: "shipping" as const, amountCents: 350 },
    { ...offer, id: "progressive", kind: "progressive" as const, amountCents: 250, discountPercent: 2.5, maxDiscountCents: 600 }];
  let reads = 0; const writes: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET" && r.url().includes("/api/")) writes.push(r.url()); });
  await page.route("**/buyer/me/benefits**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("merchant_id")).toBe("qa-store");
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    reads++; return route.fulfill({ json: benefits(all) });
  });
  await open(page);
  const section = page.getByRole("region", { name: /Oferta para este pedido|Ofertas para seus pedidos/ });
  await expect(section).toBeVisible(); await expect(section.getByRole("listitem")).toHaveCount(4);
  await expect(section).toContainText("5% nos produtos, limitado a R$ 12,00.");
  await expect(section).toContainText("R$ 3,50 aplicados nesta compra");
  await expect(section).toContainText("2,5% nos produtos, limitado a R$ 6,00.");
  await expect(section).toContainText("Cupom aplicado automaticamente: ZYON612FFE43FD5D41A682E3");
  await expect(section.locator("time").first()).toHaveAttribute("datetime", expiry);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(reads).toBe(1); expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath(`offers-${width}.png`), fullPage: true });
});

test("control, holdout and pre-enrollment responses show no personalized offer", async ({ page }) => {
  await seed(page); await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: benefits() }));
  await open(page); await expect(page.getByRole("group", { name: "Indicadores de fidelidade" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Oferta para este pedido|Ofertas para seus pedidos/ })).toHaveCount(0);
});

test("closing and reopening the hub refreshes benefits and removes withdrawn offers", async ({ page }) => {
  await seed(page); let reads = 0;
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: benefits(++reads === 1 ? [offer] : []) }));
  await open(page); await expect(page.getByText("R$ 5,00 aplicados nesta compra")).toBeVisible();
  await page.getByRole("button", { name: "Fechar conta" }).click();
  await page.getByRole("button", { name: "Abrir conta" }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByRole("region", { name: /Oferta para este pedido|Ofertas para seus pedidos/ })).toHaveCount(0);
});

test("an expired offer disappears while the hub remains open", async ({ page }) => {
  await seed(page); await page.clock.install({ time: new Date("2026-10-05T10:00:00Z") });
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: benefits([{ ...offer, expiresAt: "2026-10-05T10:00:10Z" }]) }));
  await open(page); await expect(page.getByText("R$ 5,00 aplicados nesta compra")).toBeVisible();
  await page.clock.fastForward(11_000);
  await expect(page.getByRole("region", { name: /Oferta para este pedido|Ofertas para seus pedidos/ })).toHaveCount(0);
});

test("failed refresh hides stale offers and allows retry without a new enrollment", async ({ page }) => {
  await seed(page); let reads = 0;
  await page.route("**/buyer/me/benefits**", (route) => ++reads === 2 ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: benefits([offer]) }));
  await open(page); await expect(page.getByText("R$ 5,00 aplicados nesta compra")).toBeVisible();
  await page.getByRole("button", { name: "Perfil", exact: true }).click();
  await page.getByRole("button", { name: "Fidelidade", exact: true }).click();
  await expect(page.getByText("Não foi possível atualizar seus benefícios. Tente novamente.")).toBeVisible();
  await expect(page.getByRole("region", { name: /Oferta para este pedido|Ofertas para seus pedidos/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Atualizar benefícios" }).click();
  await expect(page.getByText("R$ 5,00 aplicados nesta compra")).toBeVisible();
  expect(reads).toBe(3);
});

test("an old buyer's in-flight response cannot expose their discount after account change", async ({ page }) => {
  await seed(page); let reads = 0; let first: Route | undefined;
  await page.route("**/buyer/me/benefits**", async (route) => {
    reads++;
    if (reads === 1) { first = route; return; }
    await route.fulfill({ json: benefits([]) });
  });
  await open(page); await expect.poll(() => reads).toBe(1);
  await page.evaluate(() => {
    localStorage.setItem("zyon_buyer_token", "e30." + btoa(JSON.stringify({ sub: "another-buyer", exp: 4102444800 })) + ".local-fixture");
    window.dispatchEvent(new StorageEvent("storage", { key: "zyon_buyer_token" }));
  });
  await expect.poll(() => reads).toBe(2);
  await first!.fulfill({ json: benefits([offer]) });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("group", { name: "Indicadores de fidelidade" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Oferta para este pedido|Ofertas para seus pedidos/ })).toHaveCount(0);
});

test("changing stores scopes the read and discards the previous store's pending offer", async ({ page }) => {
  await seed(page); const scopes: string[] = []; let first: Route | undefined;
  await page.route("**/buyer/me/benefits**", async (route) => {
    scopes.push(new URL(route.request().url()).searchParams.get("merchant_id") ?? "");
    if (scopes.length === 1) { first = route; return; }
    await route.fulfill({ json: benefits([]) });
  });
  await open(page); await expect.poll(() => scopes.length).toBe(1);
  await page.getByRole("button", { name: "Outra loja" }).click();
  await expect.poll(() => scopes).toEqual(["qa-store", "another-store"]);
  await first!.fulfill({ json: benefits([offer]) });
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("group", { name: "Indicadores de fidelidade" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Oferta para este pedido|Ofertas para seus pedidos/ })).toHaveCount(0);
});
