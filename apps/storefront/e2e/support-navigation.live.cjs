// With a running storefront and API:
// SUPPORT_STOREFRONT_URL=https://host/store/athom-technologies node --test e2e/support-navigation.live.cjs
// This guest check opens navigation and submits only the read-only Suporte label.
const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('@playwright/test');
const url = process.env.SUPPORT_STOREFRONT_URL || 'http://localhost:3001/store/athom-technologies';

for (const viewport of [{ width: 390, height: 844 }, { width: 1366, height: 900 }]) {
  test(`support navigation opens native intake without tickets at ${viewport.width}px`, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport });
      let chatPosts = 0, supportPosts = 0;
      page.on('request', request => {
        if (request.method() !== 'POST') return;
        const pathname = new URL(request.url()).pathname;
        if (/\/conversations\/[^/]+\/messages$/.test(pathname)) chatPosts++;
        if (/\/buyer\/support\/tickets(?:\/|$)/.test(pathname)) supportPosts++;
      });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Não aceito', exact: true }).click();
      const chat = page.getByRole('button', { name: /^Por chat/ });
      if (await chat.isVisible()) await chat.click();
      await page.getByRole('button', { name: 'Meus Dados', exact: true }).last().click();
      const hub = page.getByRole('dialog', { name: 'Hub do comprador' });
      await hub.getByRole('textbox', { name: 'E-mail', exact: true }).waitFor();
      assert.equal(chatPosts, 0);
      await hub.getByRole('button', { name: 'Fechar painel', exact: true }).click();
      const response = page.waitForResponse(r => r.request().method() === 'POST'
        && /\/conversations\/[^/]+\/messages$/.test(new URL(r.url()).pathname)
        && r.request().postDataJSON().user_message === 'Suporte');
      const composer = page.getByRole('textbox', { name: 'Mensagem', exact: true });
      await composer.fill('Suporte'); await composer.press('Enter');
      assert((await response).ok());
      await page.getByRole('button', { name: 'Reportar Problema', exact: true }).last().waitFor();
      const before = chatPosts;
      for (const [label, text] of [
        ['Reportar Problema', 'Descreva o problema.'],
        ['Falar com Humano', 'Converse com a equipe da loja.'],
        ['FAQ', 'Perguntas frequentes'],
      ]) {
        await page.getByRole('button', { name: label, exact: true }).last().click();
        const panel = page.locator('#support-panel');
        await panel.getByText(text, { exact: true }).waitFor();
        await panel.getByRole('button', { name: 'Entrar para conversar com a loja', exact: true }).waitFor();
        assert.equal(chatPosts, before);
        assert.equal(supportPosts, 0);
        await panel.getByRole('button', { name: 'Fechar suporte', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Status do Pedido', exact: true }).last().click();
      await hub.getByRole('textbox', { name: 'E-mail', exact: true }).waitFor();
      assert.equal(chatPosts, before);
      assert.equal(supportPosts, 0);
    } finally { await browser.close(); }
  });
}
