import { expect, test, type Page } from "@playwright/test";

async function freeze(page: Page) {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
}

test("new components mount after 1500ms, not before, without restarting on rerender", async ({ page }) => {
  await page.goto("/?block-delay=1");
  await expect(page.getByRole("button", { name: "Componente history", exact: true })).toBeVisible();
  await freeze(page);
  await page.getByRole("button", { name: "Nova resposta", exact: true }).click();
  await expect(page.getByText("Aqui está sua resposta", { exact: true })).toBeVisible();
  const component = page.getByRole("button", { name: "Componente reply", exact: true });
  await expect(component).toHaveCount(0);
  await page.clock.runFor(750);
  await page.getByRole("button", { name: /^Renderizar novamente/ }).click();
  await page.clock.runFor(749);
  await expect(component).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(component).toBeVisible();
  await page.getByRole("button", { name: /^Renderizar novamente/ }).click();
  await expect(component).toBeVisible();
});

test("components without narration and late-arriving data do not wait unnecessarily", async ({ page }) => {
  await page.goto("/?block-delay=1");
  await expect(page.getByRole("button", { name: "Componente history", exact: true })).toBeVisible();
  await freeze(page);
  await page.getByRole("button", { name: "Somente componente", exact: true }).click();
  await expect(page.getByRole("button", { name: "Componente block-only", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Texto primeiro", exact: true }).click();
  await expect(page.getByText("Texto antes dos dados", { exact: true })).toBeVisible();
  await page.clock.runFor(1500);
  await page.getByRole("button", { name: "Adicionar dados", exact: true }).click();
  await expect(page.getByRole("button", { name: "Componente late", exact: true })).toBeVisible();
});

test("a deadline passing between render and effect never strands a hidden component", async ({ page }) => {
  await page.goto("/?block-delay=1");
  await expect(page.getByRole("button", { name: "Componente history", exact: true })).toBeVisible();
  await freeze(page);
  await page.getByRole("button", { name: "Nova resposta", exact: true }).click();
  await page.clock.runFor(1499);
  await page.getByRole("button", { name: "Atravessar prazo na renderização", exact: true }).click();
  await page.clock.runFor(0);
  await expect(page.getByRole("button", { name: "Componente reply", exact: true })).toBeVisible();
});

test("removed replies and conversation switches cancel stale reveals without delaying history", async ({ page }) => {
  await page.goto("/?block-delay=1");
  await expect(page.getByRole("button", { name: "Componente history", exact: true })).toBeVisible();
  await freeze(page);
  await page.getByRole("button", { name: "Nova resposta", exact: true }).click();
  await page.clock.runFor(500);
  await page.getByRole("button", { name: "Remover resposta", exact: true }).click();
  await page.clock.runFor(1500);
  await expect(page.getByRole("button", { name: "Componente reply", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Nova resposta", exact: true }).click();
  await page.getByRole("button", { name: "Trocar conversa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Componente restored", exact: true })).toBeVisible();
  await page.clock.runFor(1500);
  await expect(page.getByRole("button", { name: "Componente reply", exact: true })).toHaveCount(0);
});

for (const kind of ["quick_replies", "product_card", "cross_sell"] as const) {
  test(`storefront renders the message before ${kind} and keeps the composer usable`, async ({ page }) => {
    let productFetches = 0;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path.endsWith("/messages")) return route.fulfill({ json: {
        message: "Veja a opção que encontrei para você.",
        blocks: kind === "quick_replies"
          ? [{ type: kind, data: { options: ["Conferir opção"] } }]
          : kind === "cross_sell" ? [{ type: kind, data: { trigger: "Uma sugestão para você", displayMode: "modal",
            products: [{ id: "extra-product", name: "Produto sugerido", price: 1000, priceFormatted: "R$ 10,00" }] } }]
          : [{ type: kind, data: { id: "delay-product", name: "Produto com pausa", price: 1000,
            priceFormatted: "R$ 10,00", inStock: true } }],
      } });
      if (path.endsWith("/content")) productFetches++;
      if (path.endsWith("/conversations") || path.endsWith("/storefront-conversations")) return route.fulfill({ json: { conversation_id: "delay-conversation",
        conversation_token: `${Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:5203", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.fixture` } });
      return route.fulfill({ json: { items: [], categories: [], enabled: false } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Por chat/ }).click();
    const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await expect(composer).toBeVisible();
    await freeze(page);
    await composer.fill("Quero ver uma opção");
    await composer.press("Enter");
    await expect(page.getByText("Veja a opção que encontrei para você.", { exact: true })).toBeVisible();
    const component = kind === "quick_replies" ? page.getByRole("button", { name: "Conferir opção", exact: true })
      : kind === "cross_sell" ? page.getByRole("dialog", { name: "Sugestões para completar seu pedido", exact: true })
      : page.getByText("Produto com pausa", { exact: true });
    await expect(component).toHaveCount(0);
    await expect(composer).toBeEnabled();
    await page.clock.runFor(1499);
    await expect(component).toHaveCount(0);
    expect(productFetches).toBe(0);
    await page.clock.runFor(1);
    await expect(component).toBeVisible();
    if (kind === "product_card") await expect.poll(() => productFetches).toBe(1);
  });
}
