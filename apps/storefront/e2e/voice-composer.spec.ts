import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page, theme = "light") {
  const calls = { sessions: 0, provider: 0 };
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript((value) => localStorage.setItem("zyon-theme", value), theme);
  await page.route("https://api.openai.com/**", async (route) => { calls.provider++; await route.abort(); });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    if (pathname.endsWith("/realtime/session")) { calls.sessions++; return route.fulfill({ status: 429, json: { error: "quota" } }); }
    if (pathname.endsWith("/conversations")) return route.fulfill({ json: { conversation_id: "voice-conversation",
      conversation_token: `${Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:5203", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.fixture` } });
    return route.fulfill({ json: { items: [], categories: [], enabled: false } });
  });
  return calls;
}
async function enterChat(page: Page, query = "") {
  await page.goto(`/${query}`);
  const entry = page.getByRole("button", { name: /Por chat/ });
  if (!query.includes("disabled")) { await expect(entry).toBeVisible(); await entry.click(); }
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
}

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`microphone belongs to composer only at ${width}px ${theme}`, async ({ page }, info) => {
    const calls = await prepare(page, theme); await page.setViewportSize({ width, height: 900 });
    await enterChat(page);
    const mic = page.locator('[data-aacp-voice-channel="chat"]');
    await expect(mic).toHaveCount(1);
    await expect(page.locator('header [data-aacp-voice-channel]')).toHaveCount(0);
    await expect(page.locator('[data-aacp-composer-controls] [data-aacp-voice-channel]')).toHaveCount(1);
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    const microphone = await mic.boundingBox();
    const input = await page.getByRole("textbox", { name: "Mensagem", exact: true }).boundingBox();
    expect(microphone!.x + microphone!.width).toBeLessThan(input!.x);
    expect(microphone!.width).toBeGreaterThanOrEqual(44); expect(microphone!.height).toBeGreaterThanOrEqual(44);
    const color = await mic.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span"); probe.style.backgroundColor = "var(--aacp-accent)";
      element.append(probe); const accent = getComputedStyle(probe).backgroundColor; probe.remove();
      return { background: style.backgroundColor, accent, foreground: style.color };
    });
    expect(color.background).toBe(color.accent); expect(color.foreground).not.toBe(color.background);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(calls).toEqual({ sessions: 0, provider: 0 });
    await page.screenshot({ path: info.outputPath(`voice-composer-${width}-${theme}.png`) });
  });
}

test("denied microphone permission makes no provider call and can return to typing", async ({ page }) => {
  const calls = await prepare(page);
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true,
    value: async () => { throw new DOMException("Denied for local test", "NotAllowedError"); } }));
  await enterChat(page);
  await page.locator('[data-aacp-voice-channel="chat"]').click();
  await expect(page.getByText("Permita o uso do microfone para iniciar a compra por voz.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-aacp-voice-channel="voice"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Desativar compra por voz", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
  expect(calls).toEqual({ sessions: 0, provider: 0 });
  await expect(page.locator("audio[data-zyon-realtime-audio]")).toHaveCount(0);
});

test("voice unavailable for this store keeps text composer without a microphone entry", async ({ page }) => {
  const calls = await prepare(page); await enterChat(page, "?disabled=1");
  await expect(page.locator("[data-aacp-voice-channel]")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Mensagem", exact: true }).fill("Quero saber mais");
  await expect(page.locator("[data-aacp-composer-frame]").getByRole("button", { name: "Enviar mensagem", exact: true })).toBeEnabled();
  expect(calls).toEqual({ sessions: 0, provider: 0 });
});
