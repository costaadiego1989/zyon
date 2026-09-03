import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { CheckoutSession, ShippingQuote } from "@zyon/shared-types";
import { AcpFulfillmentSelector } from "./acp-fulfillment.selector.js";
import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";

function buildSession(
  options: ShippingQuote[] | undefined,
): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: { currency: "BRL", total: 0, items: [] },
    shippingOptions: options,
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
  };
}

function createRepo(): CheckoutSessionRepository & {
  saved: CheckoutSession[];
} {
  const saved: CheckoutSession[] = [];
  return {
    saved,
    async saveSession(s) {
      saved.push(s);
    },
    async getSession() {
      return undefined;
    },
    async findSessionsByEmail() {
      return [];
    },
    async appendChatTurn(_m, _s, t) {
      return t as unknown as CheckoutSession;
    },
    async recordEvent() {},
    async findSessionsWithTrigger() {
      return [];
    },
    async getSessionEvents() {
      return [];
    },
  };
}

test("fulfillment: throws when no shipping options", async () => {
  const repo = createRepo();
  const selector = new AcpFulfillmentSelector(repo);
  await assert.rejects(
    () => selector.selectAndApply(buildSession([]), "Correios-0"),
    (err: unknown) =>
      err instanceof BadRequestException &&
      (err.getResponse() as { message: string }).message === "acp_no_shipping_options",
  );
});

test("fulfillment: throws NotFound when index out of range", async () => {
  const repo = createRepo();
  const selector = new AcpFulfillmentSelector(repo);
  const options: ShippingQuote[] = [
    { customerPrice: 10, carrier: "Correios", method: "PAC" },
  ];
  await assert.rejects(
    () => selector.selectAndApply(buildSession(options), "Correios-5"),
    (err: unknown) => err instanceof NotFoundException,
  );
});

test("fulfillment: persists the selected shipping quote", async () => {
  const repo = createRepo();
  const selector = new AcpFulfillmentSelector(repo);
  const options: ShippingQuote[] = [
    { customerPrice: 10, carrier: "Correios", method: "PAC" },
    { customerPrice: 25, carrier: "Correios", method: "SEDEX" },
  ];
  await selector.selectAndApply(buildSession(options), "Correios-1");
  assert.equal(repo.saved.length, 1);
  assert.equal(repo.saved[0].shipping?.method, "SEDEX");
  assert.equal(repo.saved[0].shipping?.customerPrice, 25);
});

test("fulfillment: works when shippingOptions is undefined", async () => {
  const repo = createRepo();
  const selector = new AcpFulfillmentSelector(repo);
  await assert.rejects(
    () => selector.selectAndApply(buildSession(undefined), "Correios-0"),
    (err: unknown) =>
      err instanceof BadRequestException &&
      (err.getResponse() as { message: string }).message === "acp_no_shipping_options",
  );
});
