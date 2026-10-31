import assert from "node:assert/strict";
import test from "node:test";
import { formatTrackedOrderMessage } from "./tracked-order-message.js";

const owned = { found: true, orderId: "ORDER-OWNED", status: "dispatched", statusLabel: "Pedido despachado", carrier: "Correios",
  trackingAvailable: true, trackingCode: "BR998877665AA", trackingUrl: "https://tracking.example/BR998877665AA" };

test("a confirmed tracking code and HTTPS link are presented without generated suggestions", () => {
  const message = formatTrackedOrderMessage({ ...owned, message: "Compre fones", lastUpdate: "Compre acessórios" })!;
  assert.match(message, /Pedido despachado/); assert.match(message, /Transportadora.*Correios/); assert.match(message, /BR998877665AA/);
  assert.match(message, /https:\/\/tracking\.example/); assert.doesNotMatch(message, /fones|acessórios|postagem.*não.*confirmada/);
});

for (const change of [{ trackingAvailable: false }, { trackingCode: null }, { trackingCode: undefined }, { trackingCode: "pending:label" }])
  test(`unavailable/inconsistent tracking never exposes a placeholder or URL: ${JSON.stringify(change)}`, () => {
    const message = formatTrackedOrderMessage({ ...owned, ...change })!;
    assert.match(message, /rastreio.*não.*disponível/); assert.doesNotMatch(message, /BR998877665AA|https:|pending:/);
  });

for (const url of ["http://tracking.example/unsafe", "javascript:alert(1)", "https://user:secret@tracking.example/code", "not a URL"])
  test("untrusted tracking URLs are omitted while the canonical code remains available", () => {
    const message = formatTrackedOrderMessage({ ...owned, trackingUrl: url })!;
    assert.match(message, /BR998877665AA/); assert.doesNotMatch(message, /🔗|secret|javascript|http:/);
  });

test("an unknown shipment status never implies dispatch from carrier presence alone", () => {
  const message = formatTrackedOrderMessage({ ...owned, status: "pickup_pending", statusLabel: "Aguardando coleta" })!;
  assert.match(message, /Aguardando coleta/); assert.match(message, /Frete cadastrado.*Correios/); assert.doesNotMatch(message, /Transportadora|despachado|está com/);
});

for (const value of [undefined, null, {}, { found: true, status: "created" }, { error: "read_failed" }])
  test("malformed/failed output does not produce a canonical status message", () => assert.equal(formatTrackedOrderMessage(value), undefined));
