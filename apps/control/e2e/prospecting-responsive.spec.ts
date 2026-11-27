import { expect, test, type Page, type Locator } from "@playwright/test";

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

async function tabTo(page: Page, target: Locator, backwards = false) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 140; step++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    const hiddenMenu = await page.evaluate(() =>
      matchMedia("(max-width: 880px)").matches &&
      !!document.activeElement?.closest(".control-sidebar:not(.control-sidebar--open)")
    );
    expect(hiddenMenu, "A navegação lateral fechada não pode receber Tab").toBe(false);
  }
  await expect(target).toBeFocused();
}

async function activate(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}

async function typeAt(page: Page, target: Locator, text: string) {
  await tabTo(page, target);
  await page.keyboard.type(text);
}

async function checkPageWidth(page: Page, width: number) {
  const measured = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(measured).toEqual({viewport: width, document: width});
}

async function changeArea(page: Page, label: string, value: string) {
  const mobile = page.getByRole("combobox", {name: "Área da prospecção"});
  if (await mobile.isVisible()) {
    await tabTo(page, mobile, true);
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Home");
    const options = await mobile.locator("option").evaluateAll(nodes =>
      nodes.map(node => (node as HTMLOptionElement).value)
    );
    const index = options.indexOf(value);
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(mobile).toHaveValue(value);
    return;
  }
  const navigation = page.getByRole("navigation", {name: "Áreas da prospecção"});
  await activate(page, navigation.getByRole("link", {name: label, exact: true}));
}

test("PROS-31 AC2 teclado percorre a seleção, o rascunho, o atendimento e a contratação no Control autenticado", async ({page}, info) => {
  test.setTimeout(180000);
  const width = page.viewportSize()!.width;
  const local = new Set(["http://127.0.0.1:5179", "http://127.0.0.1:3019", "https://127.0.0.1:5180", "https://127.0.0.1:5181"]);
  await page.context().route("**/*", route => local.has(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.goto("/");
  await typeAt(page, page.locator('input[type="email"]'), "operador@prospecting.test");
  await typeAt(page, page.locator('input[type="password"]'), "Local-Operador-2026!");
  await page.keyboard.press("Enter");

  const menuTrigger = page.getByRole("button", {name: "Abrir navegação"});
  if (width <= 880) {
    await activate(page, menuTrigger);
    const close = page.getByRole("complementary", {name: "Navegação principal"}).getByRole("button", {name: "Fechar navegação"});
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menuTrigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(close).toBeFocused();
  }
  await activate(page, page.getByRole("button", {name: "Prospecção", exact: true}));
  if (width <= 880) await expect(menuTrigger).toBeFocused();
  await expect(page.getByRole("region", {name: "Prospecção de empresas"})).toBeVisible();

  await changeArea(page, "Buscar empresas", "companies");
  const search = page.getByRole("textbox", {name: "Pesquisar empresa"});
  await typeAt(page, search, "12ABC34501DE35");
  const filtered = page.waitForResponse(r => r.url().includes("/companies?") && r.url().includes("12ABC34501DE35"));
  await activate(page, page.getByRole("button", {name: "Aplicar filtros"}));
  expect((await filtered).ok()).toBe(true);
  const choose = page.getByRole("checkbox", {name: "Selecionar 12ABC34501DE35"});
  await tabTo(page, choose);
  await page.keyboard.press("Space");
  await expect(choose).toBeChecked();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(choose).toBeFocused();
  const companyRoute = page.url();
  await tabTo(page, page.getByRole("link", {name: "Pular para o conteúdo"}), true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(companyRoute);
  await expect(page.getByRole("main")).toBeFocused();
  await expect(search).toHaveValue("12ABC34501DE35");
  await expect(choose).toBeChecked();
  await checkPageWidth(page, width);

  await changeArea(page, "Campanhas", "campaigns");
  await activate(page, page.getByRole("button", {name: "Preparar campanha"}));
  await typeAt(page, page.getByLabel("Nome da campanha"), "Revisão por teclado " + width);
  const plan = page.getByLabel("Plano", {exact: true});
  await tabTo(page, plan);
  await page.keyboard.press("g");
  await expect(plan).toHaveValue("growth");
  const template = page.getByLabel("Template aprovado");
  await tabTo(page, template);
  await page.keyboard.press("End");
  await expect(template).not.toHaveValue("");
  await typeAt(page, page.getByLabel("Destinatários por dia"), "2");
  await typeAt(page, page.getByLabel("Orçamento (R$)"), "25");
  await checkPageWidth(page, width);
  const saved = page.waitForResponse(r => r.url().endsWith("/campaigns") && r.request().method() === "POST");
  await activate(page, page.getByRole("button", {name: "Salvar rascunho"}));
  expect((await saved).ok()).toBe(true);
  await checkPageWidth(page, width);

  await changeArea(page, "Conversas", "conversations");
  await activate(page, page.getByRole("button", {name: "Abrir conversa"}).first());
  const history = page.locator('[aria-label="Histórico de mensagens"]');
  await tabTo(page, history);
  await page.keyboard.press("End");
  await expect(history).toBeFocused();
  await expect(history.getByText("Quero o link para contratar o Growth.")).toBeVisible();
  await checkPageWidth(page, width);

  const link = history.getByRole("link", {name: "Abrir proposta de cadastro"}).first();
  await tabTo(page, link);
  const opened = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const dashboard = await opened;
  await expect(dashboard).toHaveURL(/^https:\/\/127\.0\.0\.1:5180\//);
  await activate(dashboard, dashboard.getByRole("button", {name: /^entrar/i}).first());
  await typeAt(dashboard, dashboard.locator('input[type="email"]'), "comprador@prospecting.test");
  await typeAt(dashboard, dashboard.locator('input[type="password"]'), "Local-Comprador-2026!");
  await dashboard.keyboard.press("Enter");
  const bind = dashboard.getByRole("button", {name: "Vincular proposta", exact: true});
  await tabTo(dashboard, bind);
  await expect(bind).toBeFocused();
  await checkPageWidth(dashboard, width);
  const binding = dashboard.waitForResponse(r => r.url().endsWith("/billing/prospect-proposal/bind") && r.request().method() === "POST");
  await dashboard.keyboard.press("Enter");
  expect((await binding).ok()).toBe(true);
  await expect(dashboard.getByText("Growth", {exact: true}).first()).toBeVisible();
  await checkPageWidth(dashboard, width);
  await dashboard.close();
  await page.screenshot({path: info.outputPath("teclado-control.png")});
});
