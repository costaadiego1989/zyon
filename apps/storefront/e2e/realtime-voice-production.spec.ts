import { expect, test } from "@playwright/test";

const productionUrl = process.env.ZYON_VOICE_PRODUCTION_URL;

/**
 * This consumes a single ephemeral client secret only. It never exposes a
 * permanent provider key and does not submit checkout data or payment.
 */
test.describe("Realtime voice production @voice", () => {
  test.skip(!productionUrl, "Set ZYON_VOICE_PRODUCTION_URL to a Growth storefront for this opt-in smoke test.");

  test("starts the Growth welcome greeting without browser speech synthesis", async ({ page }) => {
    let sessionStatus: number | undefined;
    page.on("response", (response) => {
      if (response.url().includes("/realtime/session")) sessionStatus = response.status();
    });
    await page.addInitScript(() => {
      const nativeSpeech = { calls: 0 };
      (window as any).__zyonNativeSpeech = nativeSpeech;
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: { cancel: () => {}, getVoices: () => [], speak: () => { nativeSpeech.calls += 1; } },
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => new MediaStream(),
      });
    });

    await page.goto(productionUrl!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Começar por voz" })).toBeVisible();
    await expect(page.getByRole("status")).toBeVisible();
    await expect.poll(() => sessionStatus, { timeout: 20_000 }).toBe(200);
    await expect(page.locator("audio[data-zyon-realtime-audio]")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => (window as any).__zyonNativeSpeech.calls)).toBe(0);
  });
});
