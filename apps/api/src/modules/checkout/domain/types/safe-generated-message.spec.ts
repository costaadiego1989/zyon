import test from "node:test";
import assert from "node:assert/strict";
import type { AuthorizedOffer } from "@zyon/shared-types";
import { isSafeGeneratedMessage } from "./safe-generated-message.js";

const approvedDiscount = (value: number): AuthorizedOffer => ({
  id: "off_1",
  merchantId: "mrc_1",
  sessionId: "chk_1",
  type: "discount_percent",
  value,
  approved: true,
  reason: "discount_allowed",
  marginAfterOffer: 0.4,
  expiresAt: "2999-01-01T00:00:00.000Z",
});

test("isSafeGeneratedMessage allows empty message", () => {
  assert.equal(isSafeGeneratedMessage("").safe, true);
});

test("isSafeGeneratedMessage blocks unauthorized percent without offer", () => {
  const result = isSafeGeneratedMessage("Posso te dar 15% de desconto agora");
  assert.equal(result.safe, false);
});

test("isSafeGeneratedMessage allows authorized percent with matching offer", () => {
  const result = isSafeGeneratedMessage(
    "Consigo aplicar 10% no seu pedido",
    approvedDiscount(10),
  );
  assert.equal(result.safe, true);
});

test("isSafeGeneratedMessage blocks percent above authorized offer", () => {
  const result = isSafeGeneratedMessage(
    "Liberei 20% pra você",
    approvedDiscount(10),
  );
  assert.equal(result.safe, false);
});

test("isSafeGeneratedMessage blocks free shipping without shipping_free offer", () => {
  const result = isSafeGeneratedMessage("Frete gratis garantido no seu pedido");
  assert.equal(result.safe, false);
});

test("isSafeGeneratedMessage blocks CVV request via extra API patterns", () => {
  const result = isSafeGeneratedMessage("Por favor digite o seu CVV");
  assert.equal(result.safe, false);
});

test("isSafeGeneratedMessage blocks authorization phrasing without percent", () => {
  const result = isSafeGeneratedMessage("Vou te dar um desconto especial");
  assert.equal(result.safe, false);
});
