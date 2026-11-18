import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppTurnContext } from "./whatsapp-turn-context.js";

const turn = { scope: { merchantId: "merchant-a", configId: "config-a", whatsappSessionId: "session-a" },
  inboxId: "inbox-a", leaseToken: "lease-a", conversationId: "conversation-a", message: "Pode chamar alguém da equipe?", origin: "text" as const };
const notice = { reply: "Canonical SQL reply", ticketId: "ticket-a", bindingId: "binding-a", epoch: 1 };
test("T57 canonical handoff notice is isolated and consumed once", async t => {
  await t.test("cannot create a notice without a verified server turn", () => {
    const context = new WhatsAppTurnContext();assert.throws(() => context.confirmHandoff(notice), /whatsapp_turn_context_required/);
    assert.equal(context.takeHandoffNotice(), undefined);
  });
  await t.test("retains the canonical committed result and consumes it once", async () => {
    const context = new WhatsAppTurnContext();
    await context.run(turn, async () => {
      context.confirmHandoff(notice);const first = context.takeHandoffNotice();
      assert.deepEqual(first, { confirmed: true, ...notice });assert.ok(Object.isFrozen(first));
      assert.equal(context.takeHandoffNotice(), undefined);
      context.confirmHandoff(notice);assert.equal(context.takeHandoffNotice(), undefined, "an already consumed result is not a resend grant");
    });
    assert.equal(context.takeHandoffNotice(), undefined);
  });
  await t.test("a different ticket/epoch cannot replace the confirmed result in one turn", () => {
    const context = new WhatsAppTurnContext();context.run(turn, () => {
      context.confirmHandoff(notice);assert.throws(() => context.confirmHandoff({ ...notice, ticketId: "other-ticket", epoch: 2 }), /whatsapp_handoff_notice_changed/);
    });
  });
  await t.test("concurrent turns and failed work retain no ambient notice", async () => {
    const context = new WhatsAppTurnContext();
    await Promise.all([context.run(turn, async () => {context.confirmHandoff(notice);await Promise.resolve();const value=context.takeHandoffNotice();if(!value?.confirmed)assert.fail("confirmed notice required");assert.equal(value.ticketId,"ticket-a");}),
      context.run({ ...turn, inboxId: "inbox-b" }, async () => {await Promise.resolve();assert.equal(context.takeHandoffNotice(),undefined);})]);
    await assert.rejects(context.run(turn, async () => {context.confirmHandoff(notice);throw Error("owned-test-error");}), /owned-test-error/);
    assert.equal(context.takeHandoffNotice(),undefined);
  });
  await t.test("a rejected ordinary tool yields only a fixed negative reply with no case/send grant", () => {
    const context=new WhatsAppTurnContext();context.run(turn,()=>{
      context.rejectHandoff("clarify");const denied=context.takeHandoffNotice();
      assert.equal(denied?.confirmed,false);assert.match(denied?.reply??"",/equipe da loja/);
      assert.deepEqual(Object.keys(denied!).sort(),["confirmed","reply"]);
      assert.equal(context.takeHandoffNotice(),undefined);
    });
  });
});
