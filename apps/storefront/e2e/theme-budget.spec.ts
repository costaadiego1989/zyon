import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  let theme: any = { accentColor: "#0f766e", backgroundColor: "#f7f8fa", textColor: "#111827", fontFamily: "system-ui", mode: "light", density: "comfortable", borderRadius: 8 };
  let budget = { enabled: false, email: "", whatsapp: "" };
  const requests: any[] = [];
  let reject = false;
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const method = route.request().method();
    const body = method === "PUT" || method === "POST" ? route.request().postDataJSON() : null;
    let data: any = {};
    if (url.pathname.endsWith("/theme")) { if (method === "PUT") theme = body; data = theme; }
    else if (url.pathname.endsWith("/store-settings")) { if (method === "PUT") budget = body.budget ?? budget; data = { budget }; }
    else if (url.pathname.endsWith("/merchants/me")) data = { id: "merchant", name: "Loja de teste", role: "owner" };
    else if (url.pathname.endsWith("/widget-config")) data = { budgetModeEnabled: budget.enabled };
    else if (url.pathname.endsWith("/budget-requests")) {
      if (method === "POST") {
        if (reject) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporarily_unavailable" }) });
        expect(route.request().headers().authorization).toContain("Bearer ");
        requests.push(body); data = { id: "budget-1", status: "pending" };
      } else data = requests.map((row) => ({ id: "budget-1", status: "pending", customerName: row.customer_name, customerEmail: row.customer_email, customerPhone: row.customer_phone, items: [{ variantId: "v", productName: "Produto de teste", quantity: 2 }], total: 240 }));
    } else if (url.pathname.includes("/cart/conversation")) data = { cartId: "conversation", items: [{ variantId: "v", productName: "Produto de teste", quantity: 2, price: 125, subtotal: 250 }], itemCount: 2, discount: 10, total: 240 };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("zyon-cart-id:merchant", "conversation");
    sessionStorage.setItem("aacp_conversation_access:conversation", btoa(JSON.stringify({ expiresAt: Date.now() / 1000 + 3600, origin: location.origin })) + ".test-signature");
  });
  return { requests, enable: () => { budget.enabled = true; }, fail: (value: boolean) => { reject = value; }, theme: () => theme, changeTheme: (patch: object) => { theme = { ...theme, ...patch }; } };
}

test("layout, radius and three color modes update immediately and survive save/reload", async ({ page }, info) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/?surface=theme");
  const preview = page.getByTestId("theme-preview");
  const widths: number[] = [];
  for (const label of ["Estreito", "Médio", "Full"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    widths.push(await preview.evaluate((el) => el.getBoundingClientRect().width));
  }
  expect(widths[0]).toBeLessThan(widths[1]); expect(widths[1]).toBeLessThan(widths[2]);
  const radius = page.getByRole("slider");
  await radius.fill("0"); await expect(preview).toHaveCSS("border-radius", "0px");
  await radius.fill("24"); await expect(preview).toHaveCSS("border-radius", "24px");
  const colors: string[] = [];
  for (const label of ["Dark", "Grey", "Light"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    colors.push(await preview.evaluate((el) => getComputedStyle(el).backgroundColor));
  }
  expect(new Set(colors).size).toBe(3);
  await page.getByRole("button", { name: "Grey", exact: true }).click();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.reload();
  await expect(preview).toHaveAttribute("data-theme", "grey");
  await expect(preview).toHaveAttribute("data-density", "spacious");
  await expect(preview).toHaveCSS("border-radius", "24px");
  await preview.screenshot({ path: info.outputPath("theme-preview.png") });
  const background = await preview.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.goto("/?surface=checkout");
  const checkout = page.locator('[data-skin="pulse"]');
  await expect(checkout).toHaveCSS("background-color", background);
  await expect(checkout.locator(".shimmer-border-wrap")).toHaveCSS("border-radius", "24px");
  await expect(checkout).toHaveCSS("max-width", "100%");

});

test("checkout adapts its sidebar to the configured width, including zero radius", async ({ page }) => {
  const state = await setup(page);
  for (const viewport of [1440, 390]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    for (const [density, maxWidth] of [["compact", 480], ["comfortable", 680], ["spacious", 1440]] as const) {
      state.changeTheme({ density, borderRadius: 0 });
      await page.goto("/?surface=checkout");
      const shell = page.locator('[data-skin="pulse"]');
      await expect(shell).toHaveCSS("width", `${Math.min(viewport, maxWidth)}px`);
      await expect(shell.locator(".shimmer-border-wrap")).toHaveCSS("border-radius", "0px");
      await expect(shell.locator(".smart-cart-sidebar")).toHaveCount(Math.min(viewport, maxWidth) < 640 ? 0 : 1);
      expect(await shell.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  }
});

for (const width of [390, 1440]) test(`quote setting persists and the storefront preserves the cart on error, then confirms a request at ${width}px`, async ({ page }, info) => {
  const state = await setup(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/?surface=settings");
  await page.getByRole("tab", { name: "Orçamento", exact: true }).click();
  await page.getByLabel("Ativar modo orçamento").check({ force: true });
  await page.getByPlaceholder("contato@loja.com").fill("merchant@example.test");
  await page.getByPlaceholder("(11) 99999-9999").fill("11999999999");
  await page.getByRole("button", { name: /Salvar configurações/ }).click();
  await page.reload();
  await page.getByRole("tab", { name: "Orçamento", exact: true }).click();
  await expect(page.getByLabel("Ativar modo orçamento")).toBeChecked();
  await expect(page.getByPlaceholder("contato@loja.com")).toHaveValue("merchant@example.test");
  await page.goto("/?surface=storefront");
  await expect(page.getByRole("button", { name: "Finalizar pedido", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Solicitar orçamento", exact: true }).click();
  await page.getByLabel("Nome completo").fill("Comprador de teste");
  await page.getByLabel("Email", { exact: true }).fill("buyer@example.test");
  await page.getByLabel("WhatsApp", { exact: true }).fill("11999999999");
  await page.getByLabel("Observação", { exact: true }).fill("Entrega na próxima semana");
  state.fail(true);
  await page.getByRole("button", { name: "Enviar solicitação", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Seus itens foram mantidos");
  await expect(page.getByText("Produto de teste", { exact: true })).toBeVisible();
  await expect(page.getByText("Orçamento enviado!", { exact: true })).toHaveCount(0);
  state.fail(false);
  await page.getByRole("button", { name: "Enviar solicitação", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Orçamento enviado!");
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toMatchObject({ merchant_id: "merchant", cart_id: "conversation", customer_name: "Comprador de teste", note: "Entrega na próxima semana" });
  expect(state.requests[0].items).toBeUndefined();
  await page.screenshot({ path: info.outputPath(`quote-success-${width}.png`) });
  await page.goto("/?surface=settings");
  await page.getByRole("tab", { name: "Orçamento", exact: true }).click();
  await expect(page.getByLabel("Solicitações de orçamento")).toContainText("Comprador de teste");
});
