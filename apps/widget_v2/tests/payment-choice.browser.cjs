// Runs the real widget UI with intercepted checkout responses. No payment or
// merchant data is created. WIDGET_TEST_URL may target the published sandbox.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const target = process.env.WIDGET_TEST_URL || 'http://127.0.0.1:5186';
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'aacp-pix-choice-'));
const experience = {
  stage: 'payment',
  items: [{ sku: 'synthetic-sku', name: 'Produto de teste', quantity: 1, unit_price: 10 }],
  shipping: { carrierKey: 'synthetic-shipping', method: 'Entrega', customerPrice: 0 },
  totals: { subtotal: 10, discount: 0, shipping: 0, service_fee: 0.99, total: 10, total_to_pay: 10.99 },
  paymentMethods: { pix: false, card: true, boleto: false },
  buyer: { name: 'Comprador Teste', email: 'buyer@example.invalid', phone: '11999990000', cpf: '00000000000' },
  brand: { name: 'Teste de usabilidade', theme: { mode: 'light' } },
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const mode of ['click', 'type', 'unavailable', 'chooser', 'service-roundtrip', 'physical-roundtrip']) {
      const snapshot = { ...experience, ...(mode === 'service-roundtrip' ? { shipping: undefined } : {}) };
      const page = await browser.newPage({ viewport: mode === 'type' ? { width: 390, height: 844 } : { width: 1366, height: 900 } });
      const calls = [];
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://qa-checkout.invalid/**', async (route) => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        const body = request.postDataJSON();
        const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
        if (request.method() === 'OPTIONS') return json({});
        if (pathname.endsWith('/embed/start')) return json({ session_id: 'synthetic-session', experience: snapshot });
        if (pathname.endsWith('/embed/checkout/edit')) {
          calls.push({ pathname, body });
          return json({ experience: snapshot, revision: calls.length });
        }
        if (pathname.endsWith('/embed/payment/intents') && request.method() === 'POST') {
          calls.push({ pathname, body });
          if (body.method === 'card') return json({ id: 'synthetic-card', method: 'card', status: 'requires_action', amountCents: 1099,
            buyerFacing: { invoiceUrl: 'https://payment.example.invalid/synthetic-card' } });
          if (mode === 'unavailable') return json({ code: 'payment_provider_not_configured' }, 400);
          return json({ id: 'synthetic-pix', method: 'pix', status: 'pending', amountCents: 1099,
            buyerFacing: { qrCodeCopyPaste: 'TEST_ONLY_NOT_A_REAL_PIX' } });
        }
        if (pathname.endsWith('/embed/chat')) return json({ session_id: 'synthetic-session', stage: 'payment',
          message: 'Escolha como pagar.', experience: snapshot, quick_replies: ['PIX', 'Pix', 'Cartão de crédito'],
          blocks: [{ type: 'payment_methods', data: { methods: [{ key: 'credito', label: 'Cartão de crédito', sub: 'Pagamento seguro com cartão' }] } }] });
        if (pathname.includes('/payment/')) return json({ status: 'pending' });
        return json({ enabledTriggers: [], maxInterventionsPerSession: 0 });
      });
      const query = new URLSearchParams({ embedToken: 'synthetic-token', merchantId: 'synthetic-store',
        apiBaseUrl: 'https://qa-checkout.invalid', channel: 'chat', ...(mode === 'chooser' ? {} : { paymentMethod: 'card' }) });
      await page.goto(`${target}/?${query}`);
      if (mode === 'chooser') {
        await page.getByRole('button', { name: 'Vamos prosseguir', exact: true }).click();
        const pix = page.getByRole('button', { name: /Pix Pagamento instantâneo/ });
        await expect(pix).toBeVisible();
        await expect(page.getByRole('button', { name: /^(PIX|Pix|Trocar para Pix)$/ })).toHaveCount(0);
        await pix.click();
        await expect(page.getByRole('heading', { name: 'Pix', exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Trocar para Pix', exact: true })).toBeVisible();
        await page.screenshot({ path: path.join(output, `${mode}-before.png`), fullPage: true });
        if (mode === 'type') {
          await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('quero pagar com Pix');
          await page.locator('[data-aacp-checkout-composer]').getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
        } else {
          await page.getByRole('button', { name: 'Trocar para Pix', exact: true }).click();
        }
        if (mode === 'unavailable') {
          await expect(page.getByText('Esta forma de pagamento ainda não está configurada pela loja. Escolha outra opção.', { exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Pix', exact: true })).toHaveCount(0);
          await expect(page.getByRole('button', { name: 'Pix', exact: true })).toBeVisible();
        } else {
          await expect(page.getByRole('heading', { name: 'Pix', exact: true })).toBeVisible();
          await expect(page.locator('.checkout-payment-panel__code code')).toContainText('TEST_ONLY_NOT_A_REAL_PIX');
        }
        assert.deepEqual(calls.map((call) => call.pathname), ['/embed/payment/intents', '/embed/checkout/edit', '/embed/payment/intents']);
      }
      if (mode.endsWith('roundtrip')) {
        await page.getByRole('button', { name: 'Trocar para Cartão de crédito', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Cartão de crédito', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Pix', exact: true })).toHaveCount(0);
        await expect(page.getByText('Forma de pagamento:', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Trocar para Pix', exact: true })).toHaveCount(1);
        const composer = page.getByRole('textbox', { name: 'Mensagem', exact: true });
        await composer.fill('Voltar');
        await composer.press('Enter');
        await expect(page.getByText('Forma de pagamento:', { exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Cartão de crédito', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^(PIX|Pix|Trocar para Pix)$/ })).toHaveCount(0);
        const pixChoice = page.getByRole('button', { name: /Pix Pagamento instantâneo/ });
        await expect(pixChoice).toHaveCount(1);
        await pixChoice.click();
        await expect(page.getByRole('heading', { name: 'Pix', exact: true })).toBeVisible();
        await composer.fill('Tenho uma dúvida');
        await composer.press('Enter');
        await expect(page.getByText('Escolha como pagar.', { exact: true })).toBeVisible();
        await expect(page.getByText('Forma de pagamento:', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Pix', exact: true })).toHaveCount(1);
        await expect(page.getByText('Selecione um frete antes de pagar.', { exact: true })).toHaveCount(0);
        assert.equal(calls.filter(call => call.pathname.endsWith('/payment/intents')).length, 4);
      }
      const pixRequests = calls.filter((call) => call.pathname.endsWith('/payment/intents') && call.body.method === 'pix').length;
      assert.equal(pixRequests, mode.endsWith('roundtrip') ? 2 : 1);
      assert.equal(calls.some((call) => /preference/.test(call.pathname)), false);
      assert.deepEqual(errors, []);
      const screenshot = path.join(output, `${mode}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ mode, initialPix: false, pixRequests, screenshot });
      await page.close();
    }
    console.log(JSON.stringify({ target, proof: 'real UI with intercepted API responses; no provider payment', results }, null, 2));
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
