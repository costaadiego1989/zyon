import { expect, test } from "@playwright/test";

test("PROS-31 AC2 mantém seleção e histórico acessíveis por teclado sem rolagem horizontal", async ({ page }, info) => {
  const width = page.viewportSize()!.width;
  const local = new Set(["http://127.0.0.1:5179","http://127.0.0.1:3019","https://127.0.0.1:5180","https://127.0.0.1:5181"]);
  await page.route("**/*", route => local.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.goto("/");
  await page.locator('input[type="email"]').fill("operador@prospecting.test");
  await page.locator('input[type="password"]').fill("Local-Operador-2026!");
  await page.getByRole("button", {name:/entrar/i}).click();
  await page.waitForFunction(() => Boolean(sessionStorage.getItem("zyon.platform-control.session.v1")));
  await page.goto("/tests/prospecting-browser-pages.html#prospecting/companies");
  const first = page.getByRole("checkbox", {name:"Selecionar 00000000000191"});
  const alpha = page.getByRole("checkbox", {name:"Selecionar 12ABC34501DE35"});
  await expect(first).toBeVisible();
  await expect(page.getByText(/Distribuição e Comércio de Equipamentos Industriais/)).toBeVisible();
  await expect(page.getByText(/9\.007\.199\.254\.740\.993,17/)).toBeVisible();
  await alpha.focus();
  await page.keyboard.press("Space");
  await expect(alpha).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath("empresas.png")});
  if (width <= 760) {
    const nav = page.getByRole("combobox", {name:"Área da prospecção"});
    await nav.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("c");
    await nav.selectOption("conversations");
  } else {
    await page.getByRole("link", {name:"Conversas",exact:true}).focus();
    await page.keyboard.press("Enter");
  }
  const open = page.getByRole("button", {name:"Abrir conversa"}).first();
  await open.focus();
  await page.keyboard.press("Enter");
  const history = page.locator('[aria-label="Histórico de mensagens"]');
  await expect(history.getByText("Quero o link para contratar o Growth.")).toBeVisible();
  await history.focus();
  await page.keyboard.press("End");
  await expect(history).toBeFocused();
  expect(await history.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await expect(page.getByRole("textbox", {name:"Nota interna"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await history.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("conversa.png")});
});
