import test from "node:test";
import assert from "node:assert/strict";
import { renderOrderConfirmationTemplate } from "./order-confirmation.template.js";
import { renderOrderShippedTemplate } from "./order-shipped.template.js";
import { renderOrderDeliveredTemplate } from "./order-delivered.template.js";
import { renderReturnApprovedTemplate } from "./return-approved.template.js";

test("order emails preserve escaped buyer data and use existing store actions instead of absent routes", () => {
  const common = { merchantId: "m1", orderId: "order-1", buyerEmail: "buyer@example.test", buyerName: "Ana <script>bad</script>" };
  const emails = [
    renderOrderConfirmationTemplate({ ...common, type: "ORDER_CONFIRMATION", orderNumber: "1001", items: [], total: "10.00" }),
    renderOrderShippedTemplate({ ...common, type: "ORDER_SHIPPED", carrier: "<script>bad</script>" }),
    renderOrderDeliveredTemplate({ ...common, type: "ORDER_DELIVERED" }),
    renderReturnApprovedTemplate({ ...common, type: "RETURN_APPROVED", returnId: "return-1", refundAmount: "<script>bad</script>" }),
  ];
  for (const html of emails) {
    assert.doesNotMatch(html, /<script>|href="[^\"]*\/(?:orders|returns|support)\//);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /atendimento|área de compras/);
  }
});

test("a return approval cannot promise a completed refund, fixed credit date or shipping label", () => {
  const html = renderReturnApprovedTemplate({ type: "RETURN_APPROVED", merchantId: "m1", orderId: "1001",
    returnId: "return-1", buyerEmail: "buyer@example.test" });
  assert.match(html, /não confirma que o reembolso foi concluído/);
  assert.match(html, /quando aplicável/);
  assert.doesNotMatch(html, /5-7|5 dias úteis|use a etiqueta/i);
});

test("shipment without tracking does not promise a future tracking code", () => {
  const event = { type: "ORDER_SHIPPED" as const, merchantId: "m1", orderId: "1001", buyerEmail: "buyer@example.test" };
  assert.doesNotMatch(renderOrderShippedTemplate(event), /Em breve você receberá/);
  const html = renderOrderShippedTemplate({ ...event, trackingNumber: 'BR"<123>' });
  assert.match(html, /rastreio\/BR%22%3C123%3E/);
});
