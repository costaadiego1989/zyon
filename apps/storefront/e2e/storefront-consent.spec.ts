import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const storeId = "consent-preview-store";
const storageKey = `zyon-storefront-consent:${storeId}`;
const screenshotDirectory = path.resolve("../../.audit/storefront-consent-20261005");
const buyerToken = (id: string) => `fixture.${Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64")}.fixture`;

async function setup(page: Page, options: { theme?: "light" | "dark"; buyer?: string; failSave?: boolean } = {}) {
  const state = { trackers: [] as string[], writes: [] as any[], granted: [] as string[], failSave: options.failSave ?? false };
  const accountChannels = new Map<string, string[]>();
  await page.route(/googletagmanager\.com|connect\.facebook\.net|analytics\.tiktok\.com|facebook\.com\/tr/, (route) => {
    state.trackers.push(route.request().url());
    return route.fulfill({ contentType: "application/javascript", body: "/* local tracker fixture */" });
  });
  await page.route("**/storefront/stores/*/contact-consent", (route) => {
    const authorization = route.request().headers().authorization;
    if (route.request().method() === "PUT") {
      state.writes.push({ ...route.request().postDataJSON(), authorization: route.request().headers().authorization });
      if (state.failSave) return route.fulfill({ status: 503, json: { success: false } });
      state.granted = route.request().postDataJSON().channels;
      accountChannels.set(authorization, state.granted);
    }
    return route.fulfill({ json: { success: true, channels: accountChannels.get(authorization) ?? [] } });
  });
  await page.addInitScript(({ theme, token }) => {
    localStorage.setItem("zyon-theme", theme);
    localStorage.setItem("pulse-channel-pref", "chat");
    if (token) localStorage.setItem("zyon_buyer_token", token);
  }, { theme: options.theme ?? "light", token: options.buyer ? buyerToken(options.buyer) : null });
  await page.goto("/store/consent-preview", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("dialog", { name: "Sua privacidade nesta loja" })).toBeVisible();
  await page.getByRole("dialog", { name: "Sua privacidade nesta loja" }).evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  return state;
}

async function readChoice(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), storageKey);
}
async function screenshot(page: Page, name: string) {
  await mkdir(screenshotDirectory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(screenshotDirectory, name), fullPage: true, animations: "disabled" });
}

for (const [name, width, height, theme] of [
  ["desktop-light", 1440, 900, "light"],
  ["mobile-light", 390, 844, "light"],
  ["mobile-dark", 390, 844, "dark"],
] as const) {
  test(`first visit, refusal and review screenshots: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const state = await setup(page, { theme });
    for (const box of await page.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
    await screenshot(page, `${name}-consent.png`);
    expect(state.trackers).toHaveLength(0);
    await page.getByRole("button", { name: "Não aceito", exact: true }).click();
    expect((await readChoice(page)).channels).toEqual([]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Cookies e contato", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Sua privacidade nesta loja" })).not.toBeVisible();
    await expect(page.locator(".conversation-header__status")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Explorar lojas parceiras", exact: true })).toHaveCount(0);
    if (width === 390) await expect(page.locator(".conversation-header > img")).toHaveCSS("width", "44px");
    await screenshot(page, `${name}-storefront.png`);
    expect(state.trackers).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

test("sheet stays open after Escape or backdrop clicks until an explicit choice", async ({ page }) => {
  await setup(page);
  await page.getByRole("checkbox", { name: "WhatsApp", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  await expect(page.getByRole("dialog", { name: "Sua privacidade nesta loja" })).toBeVisible();
  expect(await readChoice(page)).toBeNull();
  await expect(page.getByRole("button", { name: "Fechar preferências de privacidade" })).toHaveCount(0);
  await page.getByRole("button", { name: "Não aceito", exact: true }).click();
  expect((await readChoice(page)).channels).toEqual([]);
  expect((await readChoice(page)).optionalCookies).toBe(false);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("guest choice syncs after login once and cannot grant permission to another account", async ({ page }) => {
  const state = await setup(page);
  await page.getByRole("checkbox", { name: "E-mail", exact: true }).check();
  await page.getByRole("button", { name: "Aceitar seleção" }).click();
  expect(state.writes).toHaveLength(0);
  await page.evaluate((token) => {
    localStorage.setItem("zyon_buyer_token", token);
    window.dispatchEvent(new StorageEvent("storage", { key: "zyon_buyer_token" }));
  }, buyerToken("buyer-1"));
  await expect.poll(() => state.writes.length).toBe(1);
  await expect.poll(async () => (await readChoice(page)).pendingContactSync).toBe(false);
  expect(state.writes[0].channels).toEqual(["email"]);
  expect(state.trackers).toHaveLength(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Cookies e contato" })).toBeVisible();
  await page.evaluate((token) => {
    localStorage.setItem("zyon_buyer_token", token);
    window.dispatchEvent(new StorageEvent("storage", { key: "zyon_buyer_token" }));
  }, buyerToken("buyer-2"));
  await page.getByRole("button", { name: "Cookies e contato" }).click();
  await expect(page.getByRole("button", { name: "Aceitar seleção" })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "E-mail", exact: true })).not.toBeChecked();
  expect(state.writes).toHaveLength(1);
});

test("server errors remain pending until an explicit retry succeeds", async ({ page }) => {
  const state = await setup(page, { buyer: "buyer-1", failSave: true });
  await expect(page.getByRole("button", { name: "Aceitar seleção" })).toBeEnabled();
  await page.getByRole("checkbox", { name: "WhatsApp", exact: true }).check();
  await page.getByRole("button", { name: "Aceitar seleção" }).click();
  await expect(page.getByRole("status")).toContainText("Não foi possível confirmar");
  expect((await readChoice(page)).pendingContactSync).toBe(true);
  state.failSave = false;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect.poll(async () => (await readChoice(page)).pendingContactSync).toBe(false);
  expect(state.writes.at(-1).channels).toEqual(["whatsapp"]);
});

test("optional trackers load only after consent and revocation stops them on reload", async ({ page }) => {
  const state = await setup(page, { buyer: "buyer-1" });
  await expect(page.getByRole("button", { name: "Aceitar seleção" })).toBeEnabled();
  await page.getByRole("checkbox", { name: /Cookies de medição e publicidade/ }).check();
  await page.getByRole("button", { name: "Aceitar seleção" }).click();
  await expect.poll(() => state.trackers.length).toBe(3);
  await page.getByRole("button", { name: "Cookies e contato" }).click();
  await page.getByRole("button", { name: "Não aceito", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect.poll(async () => (await readChoice(page)).optionalCookies).toBe(false);
  const count = state.trackers.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Cookies e contato" })).toBeVisible();
  expect(state.trackers.length).toBe(count);
  await expect.poll(async () => (await readChoice(page)).pendingContactSync).toBe(false);
  expect(state.writes.at(-1).channels).toEqual([]);
});

test("small mobile viewport keeps actions accessible and policies readable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await setup(page);
  for (const name of ["Não aceito", "Aceitar seleção"]) {
    const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(568);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Não aceito" }).click();
  for (const policy of ["cookies", "privacidade", "termos"]) {
    await page.goto(`/politicas/${policy}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (policy === "cookies") await screenshot(page, "mobile-cookies-policy.png");
    const contact = page.getByRole("link", { name: "costaadiego1989@gmail.com", exact: true });
    await contact.scrollIntoViewIfNeeded();
    await expect(contact).toBeVisible();
  }
});

test("checkout has no contact-consent block below its input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { buyer: "buyer-1" });
  await page.getByRole("button", { name: "Não aceito", exact: true }).click();
  const message = page.getByRole("textbox", { name: "Mensagem", exact: true });
  await message.fill("Adicionar produto de demonstração");
  await message.press("Enter");
  await page.getByRole("button", { name: "Finalizar compra", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Voltar para o site", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Por chat/ }).click();
  await expect(page.getByPlaceholder("Escreva sua mensagem...")).toBeVisible();
  await expect(page.getByText("Preferências de contato desta loja", { exact: true })).toHaveCount(0);
  await screenshot(page, "mobile-checkout.png");
});
