import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutSession } from "@zyon/shared-types";
import { AcpBuyerMerger } from "./acp-buyer.merger.js";
import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";

function buildSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: { currency: "BRL", total: 0, items: [] },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
    ...overrides,
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

test("buyer: applies buyer fields when no prior customer hints", async () => {
  const repo = createRepo();
  const merger = new AcpBuyerMerger(repo);
  await merger.mergeAndApply(buildSession(), {
    email: "a@b.com",
    full_name: "Ana",
    phone: "11999",
    cpf: "123",
  });
  assert.equal(repo.saved.length, 1);
  assert.deepEqual(repo.saved[0].customer, {
    email: "a@b.com",
    fullName: "Ana",
    phone: "11999",
    cpf: "123",
  });
});

test("buyer: merges buyer fields on top of existing customer hints", async () => {
  const repo = createRepo();
  const merger = new AcpBuyerMerger(repo);
  await merger.mergeAndApply(
    buildSession({ customer: { email: "old@b.com", fullName: "Old" } }),
    { phone: "11999" },
  );
  assert.equal(repo.saved.length, 1);
  const c = repo.saved[0].customer;
  assert.equal(c?.email, "old@b.com");
  assert.equal(c?.fullName, "Old");
  assert.equal(c?.phone, "11999");
});

test("buyer: applies address fields when no prior address", async () => {
  const repo = createRepo();
  const merger = new AcpBuyerMerger(repo);
  await merger.mergeAndApply(buildSession(), undefined, {
    line_one: "Rua A, 100",
    city: "SP",
    state: "SP",
    postal_code: "01000",
  });
  assert.deepEqual(repo.saved[0].customer?.address, {
    zip: "01000",
    street: "Rua A, 100",
    number: undefined,
    complement: undefined,
    city: "SP",
    state: "SP",
  });
});

test("buyer: merges address fields while preserving number from existing", async () => {
  const repo = createRepo();
  const merger = new AcpBuyerMerger(repo);
  await merger.mergeAndApply(
    buildSession({
      customer: {
        address: { zip: "01000", street: "Old St", number: "99", city: "SP", state: "SP" },
      },
    }),
    undefined,
    { line_two: "Apt 5" },
  );
  const addr = repo.saved[0].customer?.address;
  assert.equal(addr?.street, "Old St");
  assert.equal(addr?.number, "99");
  assert.equal(addr?.complement, "Apt 5");
  assert.equal(addr?.zip, "01000");
});

test("buyer: no-op when both buyer and address are undefined", async () => {
  const repo = createRepo();
  const merger = new AcpBuyerMerger(repo);
  await merger.mergeAndApply(buildSession({ customer: { email: "kept@x.com" } }));
  assert.equal(repo.saved.length, 1);
  assert.equal(repo.saved[0].customer?.email, "kept@x.com");
});
