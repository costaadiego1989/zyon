import { expect, test } from "@playwright/test";

for (const empty of [false, true]) {
  test(`Trust labels reach the real conversation shell with${empty ? "empty" : "configured"} public theme`, async ({ page }) => {
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:33117") return route.abort();
      if (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/storefront-proxy/"))
        return route.fulfill({ json: { mode: "manual_only", enabledTriggers: [], suppressedSteps: [], blockedRegions: [] } });
      return route.continue();
    });
    await page.routeWebSocket("**/*", socket => socket.close());
    await page.goto(empty ? "/store/read-actions-empty" : "/store/read-actions");
    await page.getByRole("button", { name: "Não aceito", exact: true }).click();
    await expect(page.locator(".storefront-shell")).toBeVisible();
    const footer = page.getByRole("list", { name: "Informações da loja", exact: true });
    if (empty) await expect(footer).toHaveCount(0);
    else {
      await expect(footer.getByRole("listitem")).toHaveText(["Atendimento local", "Entrega & acompanhamento", "Informação em português", "<script>merchant-text</script>"]);
      await expect(footer.locator("script")).toHaveCount(0);
      await page.reload();
      await expect(footer.getByRole("listitem")).toHaveCount(4);
    }
  });
}
