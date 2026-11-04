import test from "node:test";
import assert from "node:assert/strict";
import { renderOrderConfirmationTemplate, renderOrderConfirmationWhatsApp } from "./order-confirmation.template.js";
import { renderMerchantOrderEmail, renderMerchantOrderWhatsApp } from "./merchant-order-notification.template.js";
import { projectPaidOrderReceipt, type PaidOrderReceipt } from "../../domain/paid-order-receipt.js";

const receipt = projectPaidOrderReceipt({ merchantId: "m1", sessionId: "s1", externalOrderId: "185874", status: "approved",
  currency: "BRL", orderTotal: "12.86", shippingCents: 1016,
  lineItemsJson: [{ unitPriceCents: 300, quantity: 1 }] }, { merchantId: "m1", sessionId: "s1", providerPaymentId: "185874",
  status: "approved", currency: "BRL", amountCents: 1385, approvedAmountCents: 1385, amountBreakdown: {
    version: 1, currency: "BRL", itemsSubtotalCents: 300, discountCents: 30, shippingCents: 1016, platformFeeCents: 99, totalCents: 1385,
  } })!;
const event = { type: "ORDER_CONFIRMATION" as const, merchantId: "m1", merchantName: "Loja <teste>", orderId: "185874",
  orderNumber: "185874", buyerEmail: "buyer@example.test", buyerName: "Ana <script>",
  items: [{ name: "Produto <script>", quantity: 1, price: "3.00" }], total: "12.86", currency: "BRL", paidReceipt: receipt };

for (const [name, render] of [["buyer", renderOrderConfirmationTemplate], ["merchant", renderMerchantOrderEmail]] as const) {
  test(`${name} email itemizes the approved charge instead of treating merchant order total as total paid`, () => {
    const html = render(event).replace(/\u00a0/g, " ");
    for (const value of ["Produtos", "Desconto", "Frete", "Taxa de serviço", "Total pago", "3,00", "0,30", "10,16", "0,99", "13,85"]) assert.ok(html.includes(value), value);
    assert.doesNotMatch(html, /<script>/);
  });
  test(`${name} legacy total is not called the approved/paid charge and never invents a zero fee`, () => {
    const html = render({ ...event, paidReceipt: undefined });
    assert.match(html, /Valor do pedido/);
    assert.doesNotMatch(html, /Total aprovado|Total pago<\/|Taxa de serviço[^<]*0[,.]00/);
  });
  test(`${name} total-only approved legacy charge states missing components explicitly`, () => {
    const partial: PaidOrderReceipt = { status: "total_only", currency: "BRL", totalPaidCents: 1385, reason: "breakdown_unavailable" };
    const html = render({ ...event, paidReceipt: partial }).replace(/\u00a0/g, " ");
    assert.match(html, /Total pago/); assert.match(html, /13,85/); assert.match(html, /Detalhamento.*indisponível/);
    assert.doesNotMatch(html, /Taxa de serviço[^<]*0[,.]00/);
  });
}

test("both WhatsApp receipts describe the same complete charge", () => {
  for (const text of [renderOrderConfirmationWhatsApp(event), renderMerchantOrderWhatsApp(event)]) {
    const normalized = text.replace(/\u00a0/g, " ");
    assert.match(normalized, /Total pago: R\$ 13,85/); assert.match(normalized, /Taxa de serviço: R\$ 0,99/);
    assert.match(normalized, /Desconto: −R\$ 0,30/); assert.doesNotMatch(normalized, /Total:.*12.86/);
  }
});

test("buyer WhatsApp confirmation leads with the paid fact, separates identity from branding and does not invent preparation", () => {
  const text = renderOrderConfirmationWhatsApp({ ...event, buyerName: "Diego Costa - Athom Technologies", merchantName: "Athom Technologies",
    items: [{ name: "Produto *teste*\nOutro título", quantity: 1, price: "3,00", productType: "physical" }] });
  assert.match(text, /^🤖 ✅ \*Pagamento aprovado!\*/);
  assert.match(text, /Seu pedido na \*Athom Technologies\* está confirmado/);
  assert.match(text, /🧾 \*Pedido #185874\*/);
  assert.match(text, /🛍️ \*Itens do pedido\*/);
  assert.match(text, /Produto teste Outro título/);
  assert.match(text, /\n🚚 Frete: /);
  assert.match(text, /\n\n✅ \*Total pago: /);
  assert.doesNotMatch(text, /Diego Costa - Athom|preparando|enviado|despachado/);
  assert.match(text, /Você pode consultar o andamento do pedido por aqui\./);
  assert.match(text, /Se precisar de ajuda, é só enviar uma mensagem\./);
  assert.doesNotMatch(text, /painel|dashboard|admin/i);
});

test("buyer email directs purchase access to the store rather than a merchant dashboard", () => {
  const html = renderOrderConfirmationTemplate(event);
  assert.match(html, /volte à loja e abra sua área de compras/);
  assert.match(html, /use o atendimento da loja/);
  assert.doesNotMatch(html, /painel|dashboard|admin/i);
});

test("a large buyer receipt remains deliverable as one WhatsApp message and labels omitted item rows", () => {
  const text = renderOrderConfirmationWhatsApp({ ...event, merchantName: "Loja ".repeat(200),
    items: Array.from({ length: 50 }, (_, index) => ({ name: `Produto ${index} ${"nome ".repeat(100)}`, quantity: 1, price: "3.00", productType: "physical" })) });
  assert(text.length <= 4096); assert.match(text, /e mais 42 itens no pedido/);
  assert.match(text.replace(/\u00a0/g, " "), /Total pago: R\$ 13,85/);
  assert.match(text.replace(/\u00a0/g, " "), /1 un\. × R\$ 3,00/);
});
