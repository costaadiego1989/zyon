import { expect, test } from "@playwright/test";

const apiBase = process.env.AACP_API_URL;
const storefrontBase = process.env.STOREFRONT_BASE_URL;
const slug = process.env.AACP_E2E_STORE_SLUG;
const productId = process.env.AACP_E2E_PRODUCT_ID;
const configured = Boolean(apiBase && storefrontBase && slug && productId);

test.describe("Product detail routing", () => {
  test.skip(!configured, "Configure the API, storefront, store slug and a local catalog product.");

  for (const available of [true, false]) {
    test(available ? "purchase data opens the product panel without editorial blocks" : "a rejected public response keeps the product card in the conversation", async ({ page, request }) => {
      const contentUrl = `${apiBase}/storefront/${encodeURIComponent(slug!)}/products/${encodeURIComponent(productId!)}/content`;
      const response = await request.get(contentUrl);
      expect(response.status()).toBe(200);
      const content = await response.json();
      const purchase = content.purchase;
      expect(purchase.productName).toEqual(expect.any(String));

      await page.route(contentUrl, route => available
        ? route.fulfill({ json: { ...content, blocks: [], faqs: [], testimonials: [], videos: [] } })
        : route.fulfill({ status: 404, json: { code: "product_content_not_found" } }));
      await page.route(/\/storefront\/conversations\/[^/]+\/messages$/, route => route.fulfill({
        json: { message: "Confira o produto solicitado.", blocks: [{ type: "product_card", data: {
          id: productId, name: purchase.productName, price: purchase.priceReais * 100,
          priceFormatted: purchase.priceReais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
          inStock: true, variants: [],
        } }] },
      }));

      await page.goto(`${storefrontBase}/store/${encodeURIComponent(slug!)}`);
      const channel = page.getByRole("button", { name: /Por chat/ });
      if (await channel.count()) await channel.first().click();
      const input = page.getByRole("textbox", { name: "Mensagem", exact: true });
      await expect(input).toBeEnabled();
      const publicResponse = page.waitForResponse(r => r.url() === contentUrl);
      await input.fill("Quero conhecer esse produto");
      await input.press("Enter");
      expect((await publicResponse).status()).toBe(available ? 200 : 404);

      if (available) {
        const panel = page.locator("[data-aacp-rich-product-experience]");
        await expect(panel).toBeVisible();
        await expect(panel.locator("h1")).toHaveText(purchase.productName);
        await expect(panel.locator("[data-aacp-rich-product-add-to-cart]")).toBeVisible();
        const copyLink = page.getByRole("button", { name: "Copiar link do produto", exact: true });
        await expect(copyLink).toBeVisible();
        await copyLink.click();
        await expect(page.getByText("Link copiado", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Fechar produto e voltar ao chat", exact: true }).click();
        await expect(panel).toHaveCount(0);
        await expect(input).toBeFocused();
        await expect(page.getByRole("button", { name: "Adicionar ao carrinho", exact: true })).toBeVisible();
      } else {
        await expect(page.locator("[data-aacp-product-detail-cta]")).toBeVisible();
        await expect(page.locator("[data-aacp-rich-product-experience]")).toHaveCount(0);
      }
    });
  }
});
