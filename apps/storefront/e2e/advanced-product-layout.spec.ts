import { expect, test } from "@playwright/test";

const apiBaseUrl = process.env.AACP_API_URL;
const storefrontBaseUrl = process.env.STOREFRONT_BASE_URL;
const storeSlug = process.env.AACP_E2E_STORE_SLUG;
const productId = process.env.AACP_E2E_PRODUCT_ID;
const configured = Boolean(apiBaseUrl && storefrontBaseUrl && storeSlug && productId);

function contentUrl() {
  return `${apiBaseUrl}/storefront/${encodeURIComponent(storeSlug!)}/products/${encodeURIComponent(productId!)}/content`;
}

function pageUrl() {
  return `${storefrontBaseUrl}/store/${encodeURIComponent(storeSlug!)}?show=content&product=${encodeURIComponent(productId!)}`;
}

/**
 * Acceptance tests for the seed-created rich layout. Run in a disposable local
 * environment: the purchase case creates a conversation and adds a cart item.
 * It never submits payment, sends OTP, or changes merchant/catalog settings.
 */
test.describe("Advanced Product Layout @apl", () => {
  test.skip(!configured, "Set AACP_API_URL, STOREFRONT_BASE_URL, AACP_E2E_STORE_SLUG and AACP_E2E_PRODUCT_ID for a seeded non-production environment.");

  test("public content includes display prices and variants without internal costs", async ({ request }) => {
    const response = await request.get(contentUrl(), { headers: { Accept: "application/json" } });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.productId).toBe(productId);
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(Array.isArray(body.faqs)).toBe(true);
    expect(Array.isArray(body.testimonials)).toBe(true);
    expect(Array.isArray(body.videos)).toBe(true);
    expect(body.purchase).toEqual(expect.objectContaining({ defaultVariantId: expect.any(String), priceReais: expect.any(Number), variants: expect.any(Array), images: expect.any(Array) }));
    expect(body.purchase.variants.length).toBeGreaterThan(1);
    expect(body.purchase).not.toHaveProperty("costInCents");
    expect(body.purchase.variants[0]).not.toHaveProperty("availableQuantity");
  });

  test("desktop rich layout stays inside the agent conversation and records a reviewable screenshot", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem("zyon-theme", "light");
      localStorage.removeItem("pulse-channel-pref");
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(pageUrl(), { waitUntil: "domcontentloaded" });

    const chat = page.locator("#storefront-chat");
    await expect(chat).toBeVisible();
    const content = chat.locator("article[data-aacp-product-content]");
    await expect(content).toBeVisible();
    await expect(chat.getByRole("dialog", { name: "Conheça o produto" })).toBeVisible();
    await expect(content.getByRole("tab")).toHaveCount(0);
    await expect(content.getByRole("navigation", { name: "Seções do produto" })).toHaveCount(0);
    await expect(content.locator(".aacp-product-content")).toBeVisible();
    await expect(content.locator("[data-aacp-rich-product-add-to-cart]")).toBeEnabled();
    await expect.poll(async () => {
      const panel = await chat.locator("[data-aacp-product-experience]").boundingBox();
      const shell = await chat.boundingBox();
      return Math.abs(panel!.width - shell!.width);
    }).toBeLessThan(4);
    await expect(content.locator("[data-aacp-rich-product-nudge]")).toBeVisible();
    await expect(content.locator("input[value$='_family']")).toBeDisabled();
    await page.getByLabel("50 ml", { exact: true }).check();
    await expect(content.locator("[data-aacp-rich-product-price]")).toContainText("189,90");
    await expect(content.locator("[data-aacp-rich-product-nudge]")).toHaveCount(0);
    await page.getByLabel("30 ml", { exact: true }).check();
    await expect(content.locator("[data-aacp-rich-product-price]")).toContainText("129,90");
    const photo = content.locator("[data-aacp-rich-product-purchase] img").first();
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const firstSrc = await photo.getAttribute("src");
    await page.getByRole("button", { name: "Próxima foto", exact: true }).click();
    await expect(photo).not.toHaveAttribute("src", firstSrc!);
    await page.getByRole("button", { name: "Foto anterior", exact: true }).click();
    await chat.screenshot({ path: testInfo.outputPath("advanced-product-layout-desktop-hero.png"), animations: "disabled" });
    for (const section of ["product-content-faq-heading", "product-content-reviews-heading", "product-content-videos-heading"]) {
      await page.locator("#" + section).scrollIntoViewIfNeeded();
      await expect(page.locator("#" + section)).toBeInViewport();
    }
    await content.locator("[data-aacp-product-scroll]").evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }));
    const screenshot = testInfo.outputPath("advanced-product-layout-desktop.png");
    await chat.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach("advanced-product-layout-desktop", { path: screenshot, contentType: "image/png" });
  });

  test("mobile rich layout remains usable and records a reviewable screenshot", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem("zyon-theme", "light");
      localStorage.removeItem("pulse-channel-pref");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pageUrl(), { waitUntil: "domcontentloaded" });

    const chat = page.locator("#storefront-chat");
    await expect(chat).toBeVisible();
    const content = chat.locator("article[data-aacp-product-content]");
    await expect(content).toBeVisible();
    await expect(content).toHaveCSS("width", /px/);
    await expect(content.locator("[data-aacp-rich-product-add-to-cart]")).toBeEnabled();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const dock = page.locator("[data-aacp-product-purchase-dock]");
    const dockBefore = await dock.boundingBox();
    await page.locator("#product-content-faq-heading").scrollIntoViewIfNeeded();
    const question = page.getByText("Qual é a textura?", { exact: true });
    await question.click();
    await expect(question.locator("xpath=ancestor::details")).toHaveAttribute("open", "");
    await expect(page.getByRole("button", { name: "Reproduzir Player demonstrativo · vídeo enviado pela loja" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Voltar ao chat", exact: true })).toBeInViewport();
    await expect(content.locator("[data-aacp-rich-product-add-to-cart]")).toBeInViewport();
    expect((await dock.boundingBox())!.y).toBeCloseTo(dockBefore!.y, 0);
    await chat.screenshot({ path: testInfo.outputPath("advanced-product-layout-mobile-details.png"), animations: "disabled" });
    await content.locator("[data-aacp-product-scroll]").evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }));

    const screenshot = testInfo.outputPath("advanced-product-layout-mobile.png");
    await expect.poll(() => content.locator("[data-aacp-rich-product-purchase] img").first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await chat.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach("advanced-product-layout-mobile", { path: screenshot, contentType: "image/png" });
    for (const section of ["reviews", "videos"]) {
      await page.locator(`#product-content-${section}-heading`).scrollIntoViewIfNeeded();
      await chat.screenshot({ path: testInfo.outputPath(`advanced-product-layout-mobile-${section}.png`), animations: "disabled" });
    }
  });

  test("rich product follows the storefront theme without replacing the merchant accent", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem("zyon-theme", "light");
      localStorage.removeItem("pulse-channel-pref");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pageUrl(), { waitUntil: "domcontentloaded" });

    const chat = page.locator("#storefront-chat");
    const content = chat.locator("article[data-aacp-product-content]");
    const cta = content.locator("[data-aacp-rich-product-add-to-cart]");
    await expect(cta).toBeEnabled();
    const before = await page.evaluate(() => ({
      accent: getComputedStyle(document.documentElement).getPropertyValue("--aacp-accent").trim(),
      background: getComputedStyle(document.documentElement).getPropertyValue("--aacp-bg").trim(),
      font: getComputedStyle(document.querySelector("[data-aacp-rich-product-renderer]")!).fontFamily,
    }));
    expect(before.accent).not.toBe("");
    expect(before.font).not.toBe("");

    await page.getByRole("button", { name: "Voltar ao chat", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Conheça o produto" })).toHaveCount(0);
    await page.getByTitle("Modo escuro").click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--aacp-bg").trim())).toBe("#08080c");
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--aacp-accent").trim())).toBe(before.accent);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("aacp:open-product-content", { detail: { productId: id } })), productId);
    await expect(cta).toBeVisible();
    await expect.poll(() => content.locator("[data-aacp-rich-product-purchase] img").first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    // Dimensions can arrive before the image has decoded and can be painted.
    await content.locator("[data-aacp-rich-product-purchase] img").first().evaluate((image) => (image as HTMLImageElement).decode());
    const screenshot = testInfo.outputPath("advanced-product-layout-mobile-dark.png");
    await chat.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach("advanced-product-layout-mobile-dark", { path: screenshot, contentType: "image/png" });
  });

  test("narration can stop, replay and close without losing the conversation", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("zyon-theme", "light");
      localStorage.removeItem("pulse-channel-pref");
      const calls = { spoken: [] as string[], cancelled: 0 };
      (window as any).__productVoice = calls;
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        getVoices: () => [],
        cancel: () => { calls.cancelled++; },
        speak: (utterance: SpeechSynthesisUtterance) => { calls.spoken.push(utterance.text); setTimeout(() => utterance.onstart?.(new Event("start") as SpeechSynthesisEvent), 10); },
      } });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pageUrl());
    const overlay = page.getByRole("dialog", { name: "Conheça o produto" });
    await expect(overlay).toBeVisible();
    await expect(page.locator("[data-aacp-chat-content]")).toHaveAttribute("inert");
    await expect(page.getByRole("button", { name: "Parar narração" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__productVoice.spoken.length)).toBe(1);
    await page.getByRole("button", { name: "Parar narração" }).click();
    await page.getByRole("button", { name: "Ouvir resumo" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__productVoice.spoken.length)).toBe(2);
    await page.getByRole("button", { name: "Reproduzir Player demonstrativo · vídeo enviado pela loja" }).click();
    await expect(page.getByRole("button", { name: "Ouvir resumo" })).toBeVisible();
    await page.getByRole("button", { name: "Ouvir resumo" }).click();
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(page.locator("[data-aacp-chat-content]")).not.toHaveAttribute("inert");
    await expect.poll(() => page.evaluate(() => (window as any).__productVoice.cancelled)).toBeGreaterThanOrEqual(3);
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("aacp:open-product-content", { detail: { productId: id } })), productId);
    await expect(overlay).toBeVisible();
    await page.getByRole("button", { name: "Fechar produto e voltar ao chat" }).click();
    await expect(overlay).toHaveCount(0);
  });

  test("mobile purchase uses the selected variant and reaches the email identity step", async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.addInitScript(() => {
      localStorage.setItem("zyon-theme", "light");
      localStorage.removeItem("pulse-channel-pref");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(pageUrl());
    await page.getByLabel("50 ml", { exact: true }).check();
    await expect(page.locator("[data-aacp-product-total]")).toContainText("189,90");
    await page.locator("[data-aacp-rich-product-add-to-cart]").click();
    await expect(page.getByText("Produto adicionado.", { exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Ver carrinho", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Conheça o produto" })).toHaveCount(0);
    const cart = page.getByRole("dialog", { name: "Carrinho", exact: true });
    await expect(cart).toBeVisible();
    await expect(cart).toContainText("189,90");
    await expect(page.getByRole("button", { name: /^Carrinho:/ })).toHaveCount(0);
    await expect(page.getByText(/\[variantId:/)).toHaveCount(0);
    await page.locator("#storefront-chat").screenshot({ path: testInfo.outputPath("advanced-product-layout-mobile-cart.png"), animations: "disabled" });
    await cart.getByRole("button", { name: "Fechar carrinho", exact: true }).click();
    await page.getByRole("button", { name: /^Carrinho:/ }).click();
    await expect(cart).toBeVisible();
    await cart.getByRole("button", { name: "Finalizar pedido", exact: true }).click();
    await expect(page.getByText("Para finalizar sua compra, confirme sua identidade")).toBeVisible();
    await expect(page.getByText(/e-mail/i).first()).toBeVisible();
  });

  test("a small screen can retry content and read the summary without speech support", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("zyon-theme", "light");
      Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
    });
    let fail = true;
    await page.route(contentUrl(), (route) => fail ? route.fulfill({ status: 503, body: "temporarily unavailable" }) : route.continue());
    await page.goto(pageUrl());
    await expect(page.getByText("Os detalhes completos deste produto não estão disponíveis agora.")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Tentar novamente", exact: true }).click();
    await expect(page.locator("[data-aacp-rich-product-add-to-cart]")).toBeEnabled();
    await page.getByText("Resumo do produto", { exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Resumo do produto" })).toContainText("Escolha a versão");
    await expect(page.getByRole("button", { name: "Ouvir resumo", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Voltar ao chat", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Conheça o produto" })).toHaveCount(0);
  });

  test("the agent product-card contract opens published content and returns to its message", async ({ page, request }) => {
    const product = await (await request.get(contentUrl())).json();
    await page.addInitScript(() => { localStorage.setItem("zyon-theme", "light"); });
    // Model output is deterministic in this contract test; content/entitlement
    // and conversation creation still use the local API.
    await page.route(/\/storefront\/conversations\/[^/]+\/messages$/, (route) => route.fulfill({
      json: { message: "Separei este produto para você.", blocks: [{ type: "product_card", data: {
        id: productId, name: product.purchase.productName, price: 12990, priceFormatted: "R$ 129,90", inStock: true, variants: [],
      } }] },
    }));
    await page.goto(pageUrl());
    await page.getByRole("button", { name: "Voltar ao chat", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Conheça o produto" })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Mensagem", exact: true }).fill("Quero conhecer esse produto");
    await page.getByRole("textbox", { name: "Mensagem", exact: true }).press("Enter");
    await expect(page.getByRole("dialog", { name: "Conheça o produto" })).toBeVisible();
    await expect(page.locator(".aacp-product-content")).toBeVisible();
    await page.getByRole("button", { name: "Fechar produto e voltar ao chat" }).click();
    await expect(page.getByText("Separei este produto para você.", { exact: true })).toBeVisible();
    await expect(page.locator("[data-aacp-product-detail-cta]")).toBeVisible();
  });
});
