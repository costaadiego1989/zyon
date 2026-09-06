import test from "node:test";
import assert from "node:assert/strict";
import { renderRecoveryEmail } from "./recovery-email.js";
import { prepareRecoveryWhatsApp, RECOVERY_TEMPLATE_DEFAULTS, renderRecoveryText } from "./recovery-template-content.js";

test("recovery email renders merchant identity, escaped copy and a single primary CTA", () => {
  const html = renderRecoveryEmail('Olá <Ana>!\n\nhttps://shop.example/cart?a=1&b=2\n\nEquipe <Loja>', 'Casa & Aurora', 'https://shop.example/cart?a=1&b=2');
  assert.match(html, /Casa &amp; Aurora/);
  assert.match(html, /Olá &lt;Ana&gt;/);
  assert.match(html, /Equipe &lt;Loja&gt;/);
  assert.equal(html.split('Retomar minha compra').length - 1, 1);
  assert.match(html, /href="https:\/\/shop.example\/cart\?a=1&amp;b=2"/);
  assert.match(html, /max-width:600px/);
  assert.doesNotMatch(html, /<Ana>|<Loja>/);
});

for (const link of ['javascript:alert(1)', 'data:text/html,hello', 'http://shop.example/cart', 'https://user:secret@shop.example/cart', 'invalid']) {
  test(`recovery email never turns unsafe destination into a button: ${link}`, () => {
    const html = renderRecoveryEmail('Seu carrinho', 'Loja', link);
    assert.doesNotMatch(html, /href=|Retomar minha compra/);
  });
}

test("default copy identifies the actual merchant in both channels and Meta variables", () => {
  const vars = { buyerName: 'Ana', storeName: 'Casa Aurora', link: 'https://shop.example/cart' };
  for (const channel of ['email', 'whatsapp'] as const) {
    const body = renderRecoveryText(RECOVERY_TEMPLATE_DEFAULTS[channel].body, vars);
    assert.match(body, /Casa Aurora/);
    assert.match(body, /Ana/);
    assert.doesNotMatch(body, /\{\{|última chance|reservad|frete grátis|desconto/i);
  }
  assert.ok(Object.values(prepareRecoveryWhatsApp(RECOVERY_TEMPLATE_DEFAULTS.whatsapp.body).variableMap).includes('storeName'));
});
