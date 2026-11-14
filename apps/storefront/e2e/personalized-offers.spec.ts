import { test, expect, type Page, type Route } from "@playwright/test";
import { currentPersonalizedOffers } from "../src/lib/personalized-offers";
import type { AvailableBenefit, BuyerPersonalizedOffer } from "../src/lib/viewmodels/useBuyerHub/types";
import type { LoyaltyCartSnapshot } from "../src/components/buyer-hub/tabs/LoyaltyTab";

// Local component/HTTP fixtures. These tests do not claim real enrollment or payment proof.
const expiry = "2099-10-06T12:30:00.000Z";
const offer: BuyerPersonalizedOffer = { id: "assigned-only", kind: "percentage", name: "Desconto", description: "",
  currency: "BRL", amountCents: 500, maxDiscountCents: 1200, discountPercent: 5, deliveryMode: "automatic",
  sessionId: "checkout-current", expiresAt: expiry, condition: "Sujeito às condições desta compra.", status: "applied" };
const benefits = (offers?: BuyerPersonalizedOffer[]) => ({ available: [], earned: [], progress: [], ...(offers ? { offers } : {}) });
async function seed(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((selectedTheme) => {
    const token = "e30." + btoa(JSON.stringify({ sub: "qa-buyer", email: "qa-buyer@example.invalid", exp: 4102444800 })) + ".local-fixture";
    localStorage.setItem("zyon_buyer_token", token);
    localStorage.setItem("zyon-theme", selectedTheme);
  }, theme);
  await page.route("**/api/buyer/**", (route) => route.fulfill({ json: route.request().url().endsWith("/loyalty")
    ? { total_orders: 0, total_spent_cents: 0, avg_order_value_cents: 0, top_categories: [], preferred_brands: [] }
    : route.request().url().endsWith("/summary") ? { orders_count: 0, total_spent: 0, average_ticket: 0, currency: "BRL" }
    : { global_user_id: "qa-buyer", display_name: "Conta de teste", items: [] } }));
}
async function open(page: Page) { await page.goto("/"); await page.getByRole("button", { name: "Fidelidade", exact: true }).click(); }

test("real buyer hub reads general coupons by public slug and personalized benefits by merchant ID", async ({ page }) => {
  await seed(page);
  const couponRequests: string[] = [], benefitScopes: string[] = [];
  await page.route("**/api/storefront/*/coupons", (route) => {
    const path = new URL(route.request().url()).pathname;
    couponRequests.push(path);
    return path === "/api/storefront/athom-teste/coupons"
      ? route.fulfill({ json: { items: [{ id: "public-coupon", code: "BEMVINDO", discount_type: "percent", discount_value: 5, usages_count: 0 }] } })
      : route.fulfill({ status: 404, json: { message: "store_not_found" } });
  });
  await page.route("**/buyer/me/benefits**", (route) => {
    benefitScopes.push(new URL(route.request().url()).searchParams.get("merchant_id") ?? "");
    return route.fulfill({ json: benefits([offer]) });
  });
  await page.goto("/?hub=1");
  await page.getByRole("tab", { name: "Fidelidade", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Fidelidade", exact: true });
  await expect(panel.getByText("BEMVINDO", { exact: true })).toBeVisible();
  await expect(panel.getByText("R$ 5,00 aplicados nesta compra")).toBeVisible();
  expect(couponRequests).toEqual(["/api/storefront/athom-teste/coupons"]);
  expect(benefitScopes).toEqual(["qa-store"]);
});

test("missing public slug never falls back to a merchant ID in the coupon URL", async ({ page }) => {
  await seed(page);
  const couponRequests: string[] = [];
  await page.route("**/api/storefront/*/coupons", (route) => { couponRequests.push(route.request().url()); return route.fulfill({ status: 404, json: {} }); });
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: benefits() }));
  await page.goto("/?hub=1&missingSlug=1");
  await page.getByRole("tab", { name: "Fidelidade", exact: true }).click();
  await expect(page.getByText("Nenhum cupom de uso geral disponível no momento.")).toBeVisible();
  expect(couponRequests).toEqual([]);
});

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
  await expect(section.getByText("Cupom aplicado automaticamente:")).toBeVisible();
  await expect(section.getByText("ZYON612FFE43FD5D41A682E3", { exact: true })).toBeVisible();
  await section.locator("summary").first().click();
  await expect(section.getByText(offer.condition).first()).toBeVisible();
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

const shippingProgress = { description: "Faltam R$200.00 para frete grátis", current: 0, target: 200, remaining: 200 };
const publicCoupon = { id: "public-welcome", code: "BEMVINDO", discount_type: "percent", discount_value: 10,
  min_cart_total: 200, max_usages: null, usages_count: 0 };

async function cartFixture(page: Page, cart?: LoyaltyCartSnapshot) {
  await page.addInitScript(({ snapshot, coupon }) => {
    (window as any).__loyaltyCartSnapshot = snapshot;
    (window as any).__loyaltyCoupons = [coupon];
  }, { snapshot: cart, coupon: publicCoupon });
}

test("without a verified cart the API's default zero never becomes a buyer's missing amount", async ({ page }) => {
  await seed(page); await cartFixture(page);
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: { ...benefits(), progress: [shippingProgress] } }));
  await open(page);
  await expect(page.getByText("Pedidos a partir de R$ 200,00, sujeitos às condições de entrega.")).toBeVisible();
  await expect(page.getByText("Pedido mínimo de R$ 200,00 em produtos.")).toBeVisible();
  await expect(page.getByText(/Faltam/)).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByText(/Cliente Ouro|Diamante|pontos/)).toHaveCount(0);
});

test("verified subtotal displays the exact remaining condition and copying does not apply a coupon", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seed(page); await cartFixture(page, { subtotalCents: 15999, itemCount: 1 });
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: { ...benefits(), progress: [shippingProgress] } }));
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(request.url()); });
  await open(page);
  await expect(page.getByText("Faltam R$ 40,01 para o valor mínimo deste cupom.")).toBeVisible();
  const progress = page.getByRole("progressbar", { name: "Valor mínimo do cupom BEMVINDO" });
  await expect(progress).toHaveAttribute("aria-valuenow", "159.99");
  await expect(progress).toHaveAttribute("aria-valuemax", "200");
  await page.getByRole("button", { name: "Copiar cupom BEMVINDO" }).click();
  await expect(page.getByText("Código copiado.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("BEMVINDO");
  await expect(page.getByRole("region", { name: "Aplicado ao seu carrinho" })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("reaching the minimum does not claim that free shipping or a coupon is applied", async ({ page }) => {
  await seed(page); await cartFixture(page, { subtotalCents: 25000, itemCount: 2 });
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: { ...benefits(), progress: [shippingProgress] } }));
  await open(page);
  await expect(page.getByText("Valor mínimo atingido. Valide o cupom no checkout.")).toBeVisible();
  await expect(page.getByText("Valor mínimo atingido. Confirme o frete no checkout.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Aplicado ao seu carrinho" })).toHaveCount(0);
  await expect(page.getByText(/aplicados nesta compra|Frete grátis aplicado/)).toHaveCount(0);
});

test("item conditions keep their quantity unit and compound conditions never invent numeric progress", async ({ page }) => {
  await seed(page); await cartFixture(page, { subtotalCents: null, itemCount: 1,
    nextNudge: { kind: "cart_item_count", gap: 2, message: "Adicione mais 2 itens para 10% de desconto", reachable: true } });
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: benefits() }));
  await open(page);
  const section = page.getByRole("region", { name: "Como aproveitar mais benefícios" });
  await expect(section.getByText("Adicione mais 2 itens para 10% de desconto")).toBeVisible();
  await expect(section.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "1 item de 3 itens");
  await expect(section).not.toContainText("R$");
  await page.addInitScript(() => { (window as any).__loyaltyCartSnapshot = { subtotalCents: 12000, itemCount: 1,
    nextNudge: { kind: "conditional", gap: 80, message: "Condição para 10% de desconto: pagamento no Pix e 3 itens no carrinho.", reachable: false } }; });
  await open(page);
  await expect(section).toContainText("pagamento no Pix e 3 itens no carrinho");
  await expect(section.getByRole("progressbar")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`mature loyalty panel uses real theme tokens at ${width}px ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 }); await seed(page, theme);
    await page.route("**/api/storefront/*/coupons", (route) => route.fulfill({ json: { items: [publicCoupon] } }));
    await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: {
      ...benefits([{ ...offer, kind: "fixed", maxDiscountCents: 500, deliveryMode: "coupon_code", couponCode: "ZYON612FFE43FD5D41A682E3" }]),
      progress: [shippingProgress],
    } }));
    await page.goto("/?hub=1");
    await page.getByRole("tab", { name: "Fidelidade", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Fidelidade", exact: true });
    await expect(panel.getByText("R$ 5,00 aplicados nesta compra")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Copiar cupom BEMVINDO" })).toBeVisible();
    await expect(panel.getByText(/Faltam/)).toHaveCount(0);
    await expect(panel.getByText("Pedidos realizados")).not.toBeVisible();
    await expect(panel.getByRole("progressbar")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await panel.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: info.outputPath(`loyalty-${theme}-${width}.png`), fullPage: true });
    await panel.getByText("Seu histórico de compras", { exact: true }).click();
    await expect(panel.getByText("Você ainda não tem compras registradas.")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`loyalty-${theme}-${width}-history.png`), fullPage: true });
  });
}

test("a public coupon failure is distinct from empty and retries without hiding applied offers", async ({ page }) => {
  await seed(page); let reads = 0;
  await page.route("**/api/storefront/*/coupons", (route) => ++reads === 1
    ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { items: [publicCoupon] } }));
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: benefits([offer]) }));
  await page.goto("/?hub=1");
  await page.getByRole("tab", { name: "Fidelidade", exact: true }).click();
  await expect(page.getByText("Não foi possível carregar os cupons.")).toBeVisible();
  await expect(page.getByText("Nenhum cupom de uso geral disponível no momento.")).toHaveCount(0);
  await expect(page.getByText("R$ 5,00 aplicados nesta compra")).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(page.getByText("BEMVINDO", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
});

test("real available and earned DTOs show conditions without invented tiers, currency or expired rewards", async ({ page }) => {
  await seed(page);
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: {
    available: [{ ruleId: "real-rule", description: "Desconto de 10% disponível", maxReais: 20, condition: "Pagamento no Pix" }],
    earned: [{ description: "Condição da última compra", value: 7, origin: "merchant_rule" },
      { description: "Benefício vencido", value: 5, origin: "merchant_rule", expiresAt: "2020-01-01T00:00:00Z" }],
    progress: [shippingProgress],
  } }));
  await open(page);
  await expect(page.getByText("Desconto de 10% disponível")).toBeVisible();
  await expect(page.getByText("Desconto limitado a R$ 20,00.")).toBeVisible();
  await expect(page.getByText("Pagamento no Pix")).toBeVisible();
  await expect(page.getByText("Condição da última compra")).toBeVisible();
  await expect(page.getByText(/Benefício vencido|NaN|R\$ 7,00|Cliente Ouro|Diamante|merchant_rule/)).toHaveCount(0);
});

// Synthetic, local UI fixtures for the published conditions contract. These
// tests do not enroll buyers, select a winning rule, or prove a sandbox grant.
const conditionalExamples: AvailableBenefit[] = [
  { ruleId: "local-progressive-3", description: "Até 3% de desconto nos produtos", discountPercent: 3,
    maxReais: 10, condition: "valor dos produtos no carrinho a partir de R$ 100,00" },
  { ruleId: "local-progressive-5", description: "Até 5% de desconto nos produtos", discountPercent: 5,
    maxReais: 15, condition: "valor dos produtos no carrinho a partir de R$ 180,00" },
  { ruleId: "local-progressive-10", description: "Até 10% de desconto nos produtos", discountPercent: 10,
    maxReais: 25, condition: "valor dos produtos no carrinho a partir de R$ 300,00" },
  { ruleId: "local-advanced-pix", description: "Até 10% de desconto nos produtos", discountPercent: 10,
    maxReais: 15, condition: "valor dos produtos no carrinho a partir de R$ 150,00 e quantidade total no carrinho a partir de 2 itens e pagamento igual a Pix" },
];
const conditionalBenefits = { available: [], earned: [], progress: [], conditions: conditionalExamples, offers: [] };

async function expectConditionalExamples(page: Page) {
  const section = page.getByRole("region", { name: "Condições das ofertas", exact: true });
  const rows = section.getByRole("list", { name: "Ofertas condicionais da loja", exact: true }).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  for (const [index, example] of conditionalExamples.entries()) {
    await expect(rows.nth(index).getByRole("heading")).toHaveText(example.description);
    await expect(rows.nth(index)).toContainText(example.condition);
    await expect(rows.nth(index)).toContainText(`Desconto limitado a ${money.format(example.maxReais!)}.`);
  }
  await expect(section).toContainText("Confira no checkout quais ofertas se aplicam ao seu pedido.");
  await expect(page.getByRole("region", { name: /^(Oferta para este pedido|Ofertas para seus pedidos|Aplicado ao seu carrinho)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Copiar cupom/ })).toHaveCount(0);
  await expect(page.getByText(/aplicados nesta compra|Cupom aplicado automaticamente|oferta desbloqueada|benefício garantido/i)).toHaveCount(0);
  await expect(section.getByRole("progressbar")).toHaveCount(0);
  return { section, rows };
}

for (const subtotalCents of [0, 12000]) {
  test(`published progressive and advanced conditions do not grant benefits with a ${subtotalCents}-cent cart`, async ({ page }, info) => {
    info.annotations.push({ type: "scope", description: "Local synthetic UI fixture; server-shaped conditions and nudge, no real checkout or sandbox enrollment." });
    await seed(page);
    // The message is an authoritative fixture input, not computed from the four
    // catalog entries by the UI. Multiple unmet conditions have no numeric bar.
    const nextNudge = subtotalCents === 0
      ? { kind: "cart_total", gap: 100, reachable: true,
        message: "Faltam R$ 100,00 para até 3% de desconto no carrinho (limite de R$ 10,00)" }
      : { kind: "conditional", reachable: false,
        message: "Condição para até 10% de desconto no carrinho (limite de R$ 15,00): valor dos produtos no carrinho a partir de R$ 150,00 e quantidade total no carrinho a partir de 2 itens e pagamento igual a Pix." };
    await page.addInitScript((snapshot) => {
      (window as any).__loyaltyCartSnapshot = snapshot;
      (window as any).__loyaltyCoupons = [];
    }, { subtotalCents, itemCount: subtotalCents === 0 ? 0 : 1, nextNudge, activeRules: [], freeShipping: false });
    const writes: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/") && request.method() !== "GET") writes.push(request.url()); });
    await page.route("**/buyer/me/benefits**", (route) => {
      expect(new URL(route.request().url()).searchParams.get("merchant_id")).toBe("qa-store");
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      return route.fulfill({ json: conditionalBenefits });
    });
    await open(page);
    await expectConditionalExamples(page);
    const next = page.getByRole("region", { name: "Como aproveitar mais benefícios", exact: true });
    await expect(next).toContainText(nextNudge.message);
    if (subtotalCents === 0) {
      await expect(next.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
      await expect(next.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "100");
    } else {
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await expect(page.getByText(/Faltam R\$|Valor mínimo atingido/)).toHaveCount(0);
    }
    expect(writes).toEqual([]);
  });
}

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`published conditional offers in the full buyer hub at ${width}px ${theme}`, async ({ page }, info) => {
    info.annotations.push({ type: "scope", description: "Local mocked API with synthetic examples; real BuyerHubPanel component, no sandbox or payment proof." });
    await page.setViewportSize({ width, height: 900 }); await seed(page, theme);
    await page.route("**/api/storefront/*/coupons", (route) => route.fulfill({ json: { items: [] } }));
    await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: conditionalBenefits }));
    await page.goto("/?hub=1");
    await page.getByRole("tab", { name: "Fidelidade", exact: true }).click();
    const { section, rows } = await expectConditionalExamples(page);
    // This full-panel fixture has no CartProvider response. Catalog conditions
    // must remain visible without inventing the cart's progress or eligibility.
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByText(/Faltam|Valor mínimo atingido/)).toHaveCount(0);
    await section.getByRole("heading", { name: "Condições das ofertas", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await section.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.screenshot({ path: info.outputPath(`conditional-offers-local-${theme}-${width}.png`), fullPage: true });
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last().getByText(conditionalExamples[3].condition, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`conditional-offers-local-${theme}-${width}-advanced.png`), fullPage: true });
  });
}

test("an explicitly empty conditions catalog does not fall back to legacy available benefits", async ({ page }) => {
  await seed(page);
  await page.route("**/buyer/me/benefits**", (route) => route.fulfill({ json: {
    ...conditionalBenefits, conditions: [], available: [conditionalExamples[0]],
  } }));
  await open(page);
  await expect(page.getByText("Nenhum cupom de uso geral disponível no momento.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Condições das ofertas", exact: true })).toHaveCount(0);
  await expect(page.getByText(conditionalExamples[0].description, { exact: true })).toHaveCount(0);
});
