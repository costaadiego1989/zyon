import { expect, test } from "@playwright/test";
import { navigateToCheckout, selectChatChannel, setupCrossSellMocks } from "./fixtures/cross-sell-mocks";

for (const [width, mode] of [[390, "light"], [1440, "dark"]] as const) {
  test(`checkout shows narration 1500ms before its component and quick replies at ${width}px ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setupCrossSellMocks(page, {
      brand: { mode },
      chatMessage: "Confira os detalhes antes de continuar.",
      chatBlocks: [{ type: "text", data: { content: "Conteúdo do componente de checkout" } }],
      chatQuickReplies: ["Conferir detalhes"],
    });
    await navigateToCheckout(page);
    await selectChatChannel(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const composer = page.getByRole("textbox", { name: "Mensagem", exact: true });
    await composer.fill("Quais são os detalhes?");
    await composer.press("Enter");
    await expect(page.getByText("Confira os detalhes antes de continuar.", { exact: true })).toBeVisible();
    const component = page.getByText("Conteúdo do componente de checkout", { exact: true });
    const reply = page.getByRole("button", { name: "Conferir detalhes", exact: true });
    await expect(component).toHaveCount(0);
    await expect(reply).toHaveCount(0);
    await expect(composer).toBeEnabled();
    await page.clock.runFor(1499);
    await expect(component).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(component).toBeVisible();
    await expect(reply).toBeVisible();
  });
}
