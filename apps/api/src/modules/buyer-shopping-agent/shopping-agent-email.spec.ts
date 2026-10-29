import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShoppingAgentEmail, shoppingAgentEmailFrom } from "./infrastructure/shopping-agent-email.js";
import type { ShoppingActivity } from "./domain/shopping-agent.js";

const activity: ShoppingActivity = { id: "alert", taskId: "task", taskRevision: 1, key: "task:1:1",
  createdAt: new Date().toISOString(), kind: "opportunity", message: "Encontramos uma condição para sua tarefa.",
  decision: "pending", deliveries: {}, quote: { items: [{ productId: "p", variantId: "v", quantity: 2, name: "Café <Especial>", sku: "sku", unitPriceCents: 2500 }],
    subtotalCents: 5000, discountCents: 500, shippingCents: null, serviceFeeCents: 100, totalCents: 4600,
    currency: "BRL", available: true, discountPercent: 10, fingerprint: "quote", expiresAt: new Date().toISOString() } };
const input = { buyerName: "Diego", storeName: "Minha Loja", link: "https://loja.example/store/loja?agent=alert", activity };

test("email includes the store logo, readable quote and a review action without claiming a purchase", () => {
  const email = buildShoppingAgentEmail({ ...input, logoUrl: "https://cdn.example/logo.png?a=1&b=2" });
  assert.match(email.html, /src="https:\/\/cdn.example\/logo.png\?a=1&amp;b=2"/);
  assert.match(email.html, /alt="Logo de Minha Loja"/);
  assert.match(email.html, /Café &lt;Especial&gt;/);
  assert.match(email.html, /Total sem frete/);
  assert.match(email.html, /A calcular no checkout/);
  assert.match(email.html, /só acontece após sua confirmação/);
  assert.match(email.text!, /2 × Café <Especial>/);
  assert.equal(email.attachments, undefined);
});

test("uploaded base64 logos become inline MIME images instead of data URLs in HTML", () => {
  const email = buildShoppingAgentEmail({ ...input, logoUrl: "data:image/png;base64,aGVsbG8=" });
  assert.match(email.html, /src="cid:shopping-store-logo"/);
  assert.doesNotMatch(email.html, /data:image/);
  assert.deepEqual(email.attachments, [{ filename: "logo.png", content: "aGVsbG8=", contentType: "image/png", contentId: "shopping-store-logo" }]);
});

test("missing or unsafe logos leave the store name visible without a broken image", () => {
  for (const logoUrl of [undefined, "", "javascript:alert(1)", "http://cdn.example/logo.png", "https://user:password@cdn.example/logo.png", "data:text/html;base64,YQ==", "data:image/svg+xml;base64,YQ=="]) {
    const email = buildShoppingAgentEmail({ ...input, logoUrl });
    assert.doesNotMatch(email.html, /<img /);
    assert.match(email.html, /Minha Loja/);
    assert.equal(email.attachments, undefined);
  }
});

test("all merchant and buyer copy is escaped in the subject, body and image alt text", () => {
  const email = buildShoppingAgentEmail({ ...input, storeName: 'Loja \"><script>\r\n', buyerName: '<img src=x onerror="alert(1)">',
    logoUrl: "https://cdn.example/logo.png", activity: { ...activity, message: "<script>alert(1)</script>" } });
  assert.doesNotMatch(email.html, /<script>|<img src=x|alt="Logo de Loja ">/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.subject, /[\r\n]/);
});

test("a notification without a quote omits the price block and still links to the task", () => {
  const email = buildShoppingAgentEmail({ ...input, activity: { ...activity, kind: "unavailable", quote: undefined } });
  assert.doesNotMatch(email.html, /Resumo para sua revisão|Total para revisar/);
  assert.match(email.html, /Revisar minha tarefa/);
  assert.match(email.text!, /Para pausar os avisos/);
});

test("unsafe task URLs are rejected before sending", () => {
  for (const link of ["http://loja.example", "javascript:alert(1)", "https://user:pass@loja.example"]) {
    assert.throws(() => buildShoppingAgentEmail({ ...input, link }), /agent_email_link_invalid/);
  }
});

test("sender identifies the store while preserving the verified delivery mailbox", () => {
  assert.equal(shoppingAgentEmailFrom("Zyon <pedidos@example.com>", 'Loja "Café"\r\nTeste'), '"Loja \\"Café\\" Teste via Zyon" <pedidos@example.com>');
  assert.equal(shoppingAgentEmailFrom("pedidos@example.com", "Loja"), '"Loja via Zyon" <pedidos@example.com>');
  assert.throws(() => shoppingAgentEmailFrom("pedidos@example.com\r\nBcc:outro@example.com", "Loja"), /agent_email_sender_invalid/);
});
