import test from "node:test";
import assert from "node:assert/strict";
import { parseCashbackCommand, respondToCashbackCommand, type CashbackChannelOperations } from "./cashback-whatsapp.commands.js";
import type { CheckoutSession, CashbackCheckoutQuote } from "@zyon/shared-types";

const session = { merchantId: "m", sessionId: "checkout", globalUserId: "verified-buyer" } as CheckoutSession;
const quote: CashbackCheckoutQuote = { merchantId: "m", sessionId: "checkout", programActive: true, eligible: true, reason: null,
  availableCents: 3000, maximumRedeemCents: 2000, reservedCents: 0, estimatedEarnCents: 400, ruleVersion: 1, fingerprint: "authoritative", terms: "regras" };
function operations() {
  const writes: Array<{ session: CheckoutSession; amountCents: number; key: string }> = [];
  const deps: CashbackChannelOperations = {
    quoteCheckout: async () => quote,
    reserveCheckout: async (scope, amountCents, key) => { writes.push({ session: scope, amountCents, key }); return { ...quote, reservedCents: amountCents }; },
    releaseReservation: async () => ({ ...quote, reservedCents: 0 }),
  };
  return { deps, writes };
}
test("CB-13 WhatsApp requires an explicit monetary cashback request", async () => {
  const { deps, writes } = operations();
  for (const message of ["sim", "não use R$ 10 de cashback", "se eu usar R$ 10 de cashback", "produto com cashback", "usar R$ 1.000 de cashback"]) {
    assert.equal(parseCashbackCommand(message), null);
    assert.equal(await respondToCashbackCommand(deps, session, message), null);
  }
  assert.equal(writes.length, 0);
});
test("CB-13 WhatsApp quotes an amount before a bare use request changes balance", async () => {
  const { deps, writes } = operations();
  const response = await respondToCashbackCommand(deps, session, "Quero usar meu cashback");
  assert.match(response!.agentMessage, /Confirme o valor/);
  assert.deepEqual(parseCashbackCommand(response!.quickReplies[0]!), { kind: "apply", amountCents: 2000 });
  assert.equal(writes.length, 0);
});
test("CB-13 WhatsApp applies only the confirmed amount in the authenticated session", async () => {
  const { deps, writes } = operations();
  const response = await respondToCashbackCommand(deps, session, "Usar R$ 10,50 de cashback", "message-1");
  assert.match(response!.agentMessage, /aplicados a este pedido/);
  assert.equal(writes[0]!.amountCents, 1050);
  assert.equal(writes[0]!.session, session);
  await respondToCashbackCommand(deps, session, "Usar R$ 10,50 de cashback", "message-1");
  assert.equal(writes[1]!.key, writes[0]!.key);
});
test("CB-13 WhatsApp refuses an excessive amount and asks for a new choice", async () => {
  const { deps, writes } = operations();
  const response = await respondToCashbackCommand(deps, session, "Usar R$ 30 de cashback");
  assert.match(response!.agentMessage, /máximo disponível/);
  assert.equal(writes.length, 0);
});
test("CB-20 WhatsApp reads the authoritative store balance without a write", async () => {
  const { deps, writes } = operations();
  const response = await respondToCashbackCommand(deps, session, "Meu saldo de cashback");
  assert.match(response!.agentMessage, /saldo disponível/);
  assert.match(response!.agentMessage, /30,00/);
  assert.equal(writes.length, 0);
});
test("CB-14 WhatsApp does not claim success after an uncertain reservation", async () => {
  const { deps } = operations();
  deps.reserveCheckout = async () => { throw new Error("unknown"); };
  const response = await respondToCashbackCommand(deps, session, "Usar R$ 10 de cashback");
  assert.match(response!.agentMessage, /Não consegui confirmar/);
  assert.doesNotMatch(response!.agentMessage, /aplicados a este pedido/);
});
test("CB-13 WhatsApp removal is explicit and scoped", async () => {
  const { deps } = operations(); let removed: CheckoutSession | null = null;
  deps.releaseReservation = async scope => { removed = scope; return quote; };
  const response = await respondToCashbackCommand(deps, session, "Remover cashback");
  assert.equal(removed, session);
  assert.match(response!.agentMessage, /removido/);
});
