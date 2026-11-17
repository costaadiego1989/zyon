import assert from "node:assert/strict";
import test from "node:test";
import { HandleMetaConversationUseCase } from "./handle-meta-conversation.use-case.js";
import { WHATSAPP_HANDOFF_ACK } from "../../../support/application/whatsapp-support-intake.js";

// Unit boundary only, following the existing claimed-inbox/route fixture.
// Native109 separately proves actual SQL/authority/adapter request initiation.
function fixture(phase: "generating" | "dispatching" | "prepared" | "complete") {
  const counts = { model: 0, sends: 0, sessionWrites: 0, inboxWrites: 0 };
  const original = { version: 1 as const, conversationId: "conversation1", stage: "store" as const, history: [], revision: "original", page: 0, previousViews: [] };
  const state = { ...original, revision: "turn1" };
  const payload = { merchantId: "merchant1", deviceId: "META_CLOUD:config1", provider: "META_CLOUD", fromNumber: "5511999990000",
    body: "Quero falar com atendente", messageType: "text", timestamp: Date.now() };
  const saved = { purpose: "human_handoff", handoff: { confirmed: true, ticketId: "ticket1", bindingId: "binding1", epoch: 1, reply: WHATSAPP_HANDOFF_ACK },
    phase, state, sessionId: "session1", previousRevision: "original", sessionApplied: phase === "complete",
    sent: phase === "complete" ? [{ index: 0, messageId: "wamid.original" }] : [],
    presentation: { messages: [{ type: "text", text: { body: WHATSAPP_HANDOFF_ACK } }], selections: {}, numericSelections: [], page: 0, totalPages: 1 } };
  const claim: any = { id: "turn1", kind: "message", dedupKey: "turn1", eventId: "turn1", merchantId: "merchant1", configId: "config1",
    deviceId: "META_CLOUD:config1", streamKey: "stream1", payload, payloadHash: "synthetic-local-hash", leaseToken: "lease1", attempts: 1, responseState: saved };
  const route: any = { whatsappSession: { id: "session1", merchantId: "merchant1", deviceId: payload.deviceId, buyerPhone: payload.fromNumber,
    status: "active", conversationState: phase === "complete" ? structuredClone(state) : structuredClone(original) },
    isNew: false, buyerData: { globalUserId: "buyer1", phone: payload.fromNumber, phoneVerified: true } };
  const input = { ...payload, inboxClaim: claim };
  const conversation = { respondStore: async () => { counts.model++; assert.fail("resume must not regenerate"); } };
  const sessions = { update: async (_id: string, update: any) => { counts.sessionWrites++; Object.assign(route.whatsappSession, update); } };
  const inbox = { saveResponse: async (_claim: unknown, response: any) => { counts.inboxWrites++; claim.responseState = structuredClone(response); return true; } };
  const emitted: any[] = [], sender = { sendUi: async (value: any) => { counts.sends++; emitted.push(structuredClone(value)); return { status: "sent", messageId: "wamid.current" }; } };
  const subject = new HandleMetaConversationUseCase(conversation as never, sessions as never, inbox as never, sender as never);
  return { counts, claim, route, emitted, resume: () => subject.resumeHandoffNotice(input, route) };
}

for (const phase of ["generating", "dispatching"] as const) test(`T109 resume refuses uncertain ${phase} before any write or SDK`, async () => {
  const f = fixture(phase), saved = f.claim.responseState, before = structuredClone(saved), routeBefore = structuredClone(f.route);
  await assert.rejects(f.resume(), (error: unknown) => error instanceof Error && error.message === "whatsapp_turn_result_unknown");
  assert.equal(f.claim.responseState, saved); assert.deepEqual(f.claim.responseState, before); assert.deepEqual(f.route, routeBefore);
  assert.deepEqual(f.counts, { model: 0, sends: 0, sessionWrites: 0, inboxWrites: 0 }); assert.deepEqual(f.emitted, []);
});

test("T109 valid prepared handoff resumes its exact persisted notice once", async () => {
  const f = fixture("prepared"); assert.equal(await f.resume(), true);
  assert.equal(f.counts.model, 0); assert.equal(f.counts.sends, 1); assert.equal(f.counts.sessionWrites, 1);
  assert.equal(f.emitted[0].uiMessage.text.body, WHATSAPP_HANDOFF_ACK); assert.equal(f.emitted[0].correlationId, "zyon:turn1:0");
  assert.equal(f.claim.responseState.phase, "complete"); assert.deepEqual(f.claim.responseState.sent, [{ index: 0, messageId: "wamid.current" }]);
  assert.equal(f.route.whatsappSession.conversationState.revision, "turn1");
});

test("T109 complete handoff keeps its original sent proof without another request", async () => {
  const f = fixture("complete"), before = structuredClone(f.claim.responseState), routeBefore = structuredClone(f.route);
  assert.equal(await f.resume(), true); assert.deepEqual(f.claim.responseState, before); assert.deepEqual(f.route, routeBefore);
  assert.equal(f.counts.model, 0); assert.equal(f.counts.sends, 0); assert.equal(f.counts.sessionWrites, 0); assert.deepEqual(f.emitted, []);
});
