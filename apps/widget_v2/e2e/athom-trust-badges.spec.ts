import { expect, test } from "@playwright/test";
import { navigateToCheckout, selectChatChannel, setupCrossSellMocks } from "./fixtures/cross-sell-mocks.js";

for (const empty of [false, true]) {
  test(`Trust labels flow through the real checkout store and layout with${empty ? "an explicit empty override" : "the merchant theme"}`, async ({ page }) => {
    await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:18176" ? route.continue() : route.abort());
    await page.routeWebSocket("**/*", socket => socket.close());
    const labels = ["Atendimento local", "Entrega & acompanhamento", "Informação em português", "<script>merchant-text</script>"];
    await setupCrossSellMocks(page, { brand: { ...(empty ? { trustBadges: [] } : {}), theme: { trustBadges: labels } } });
    await navigateToCheckout(page, "http://127.0.0.1:18176"); await selectChatChannel(page);
    const footer = page.getByRole("list", { name: "Informações da loja", exact: true });
    if (empty) await expect(footer).toHaveCount(0);
    else { await expect(footer.getByRole("listitem")).toHaveText(labels); await expect(footer.locator("script")).toHaveCount(0); }
  });
}
