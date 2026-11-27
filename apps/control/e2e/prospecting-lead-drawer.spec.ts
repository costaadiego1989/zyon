import { expect, test } from "@playwright/test";

test("PROS-25 AC6 teclado, foco restaurado e rolagem da ficha sobre a lista", async ({ page }, info) => {
  const origins = new Set([
    "http://127.0.0.1:5179",
    "http://127.0.0.1:3019",
    "https://127.0.0.1:5180",
    "https://127.0.0.1:5181",
  ]);
  await page.route("**/*", (route) =>
    origins.has(new URL(route.request().url()).origin) ? route.continue() : route.abort()
  );
  await page.goto("/");
  await page.locator('input[type="email"]').fill("operador@prospecting.test");
  await page.locator('input[type="password"]').fill("Local-Operador-2026!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForFunction(() => Boolean(sessionStorage.getItem("zyon.platform-control.session.v1")));
  await page.goto("/tests/prospecting-browser-pages.html#prospecting/leads");
  const cnpj = "00000000000191";
  const trigger = page.getByRole("button", { name: cnpj, exact: true });
  await page.getByRole("textbox", { name: "Buscar por CNPJ" }).fill(cnpj);
  await page.getByRole("button", { name: "Pesquisar" }).click();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: "Fechar ficha do lead" });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Salvar lead" })).toBeVisible();
  const deepLink = page.url();
  expect(new URL(deepLink).hash).toContain("search=" + cnpj);
  const bounds = await dialog.boundingBox();
  expect(bounds).toBeTruthy();
  const width = page.viewportSize()!.width;
  expect(Math.round(bounds!.x + bounds!.width)).toBe(width);
  if (width > 600) expect(bounds!.width).toBeLessThan(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await expect(dialog.getByText("Telefone · (11) 99999-9999", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("lead-drawer.png") });
  const maskedPhone = dialog.getByText("Telefone · (11) 99999-9999", { exact: true });
  await maskedPhone.scrollIntoViewIfNeeded();
  await expect(maskedPhone).toBeInViewport();
  await page.screenshot({ path: info.outputPath("lead-drawer-contacts.png") });
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Abrir conversa" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  const tag = "Revisão local " + width;
  await dialog.getByLabel("Etiquetas separadas por vírgula").fill(tag);
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/platform/prospecting/prospects/")
  );
  await dialog.getByRole("button", { name: "Salvar lead" }).click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect((await response.json()).tags).toContain(tag);
  await expect(dialog.getByText("Lead atualizado.")).toBeVisible();
  await dialog.getByRole("button", { name: "Abrir conversa" }).scrollIntoViewIfNeeded();
  expect(await dialog.locator(".detail-drawer__content").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(close).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Buscar por CNPJ" })).toHaveValue(cnpj);
  await page.goto(deepLink);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Etiquetas separadas por vírgula")).toHaveValue(tag);
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Buscar por CNPJ" })).toHaveValue(cnpj);
});
