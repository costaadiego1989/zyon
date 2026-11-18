// UNIMPORTED/UNEXECUTED cache contracts. Actual SQL/dispatch proof remains required.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import type { HandoffState } from "./whatsapp-handoff-state.js";
import type { WhatsAppOperatorTicket } from "./whatsapp-operator-authorization.js";
import { prepareWhatsAppClose, currentResumeCase, initialResumeDelivery, parseResumeDispatch, ownsResumeDispatch,
  WHATSAPP_RESUME_REQUESTED, WHATSAPP_RESUME_TEXT, whatsappResumeDeliveryId, type WhatsAppResumeAuthority } from "./whatsapp-resume-command.js";

const scope = { merchantId: "merchant-a", configId: "config-a", whatsappSessionId: "session-a" };
const actor = { kind: "human", tenantId: "merchant-a", userId: "operator-a", role: "staff" } as TenantPrincipal;
const binding: HandoffState = { ...scope, id: "binding-a", ticketId: "ticket-a", mode: "human", epoch: 7, assignedOperatorId: "operator-a" };
const ticket: WhatsAppOperatorTicket = { id: "ticket-a", merchantId: "merchant-a", sessionId: "session-a", source: "whatsapp", status: "in_progress", assignedTo: "operator-a", mergedIntoId: null };
const closedBinding: HandoffState = { ...binding, mode: "ai", epoch: 8, assignedOperatorId: null };
const closedTicket = { ...ticket, status: "closed" };
const authority: WhatsAppResumeAuthority = { ...scope, bindingId: "binding-a", ticketId: "ticket-a", operatorId: "operator-a", previousEpoch: 7, epoch: 8,
  deviceId: "device-a", provider: "META_CLOUD", recipient: "+5511999999999", accountId: "synthetic-phone-account", identityStatus: "available" };
const session = { id: "session-a", merchantId: "merchant-a", deviceId: "device-a", status: "active", buyerPhone: "+5511999999999" };

test("T56", async t => {
  await t.test("closes only the current claimed case without mutating source facts", () => {
    const original = structuredClone({ binding, ticket, session });
    assert.deepEqual(prepareWhatsAppClose(scope, binding, ticket, actor, 7, "closed"), { replay: false, previousEpoch: 7, epoch: 8, status: "closed" });
    assert.deepEqual({ binding, ticket, session }, original);
  });
  await t.test("keeps existing claimed operator roles, not a broader owner override", () => {
    for (const role of ["owner", "admin", "staff"]) assert.equal(prepareWhatsAppClose(scope, binding, ticket, { ...actor, role } as TenantPrincipal, 7, "resolved").epoch, 8);
    assert.throws(() => prepareWhatsAppClose(scope, binding, ticket, { ...actor, userId: "other", role: "owner" } as TenantPrincipal, 7, "closed"), { message: "whatsapp_claim_owned_by_another_operator" });
  });
  await t.test("rejects machine, foreign and malformed principals before any transition", () => {
    for (const principal of [{ ...actor, kind: "m2m" }, { ...actor, tenantId: "foreign" }, { ...actor, role: "unknown" }])
      assert.throws(() => prepareWhatsAppClose(scope, binding, ticket, principal as TenantPrincipal, 7, "closed"), /human_operator_required/);
  });
  await t.test("rejects stale/foreign/aliased/non-whatsapp tickets and unclaimed cases", () => {
    for (const invalid of [{ ...ticket, id: "old-ticket" }, { ...ticket, merchantId: "foreign" }, { ...ticket, sessionId: "other-session" }, { ...ticket, source: "storefront" }, { ...ticket, mergedIntoId: "alias" }])
      assert.throws(() => prepareWhatsAppClose(scope, binding, invalid, actor, 7, "closed"), /whatsapp_case_not_found/);
    assert.throws(() => prepareWhatsAppClose(scope, { ...binding, mode: "waiting_human", assignedOperatorId: null }, { ...ticket, status: "open", assignedTo: null }, actor, 7, "closed"), /not_claimed/);
  });
  await t.test("rejects old/future/fractional/missing/exhausted epochs", () => {
    for (const epoch of [6, 8, -1, 7.5, Number.NaN, 2_147_483_648]) assert.throws(() => prepareWhatsAppClose(scope, binding, ticket, actor, epoch, "closed"), /epoch_conflict/);
    assert.throws(() => prepareWhatsAppClose(scope, { ...binding, epoch: 2_147_483_647 }, ticket, actor, 2_147_483_647, "closed"), /epoch_conflict/);
  });
  await t.test("permits only an exact closed-case replay candidate for original or resulting epoch", () => {
    for (const epoch of [7, 8]) assert.deepEqual(prepareWhatsAppClose(scope, closedBinding, closedTicket, actor, epoch, "closed"), { replay: true, previousEpoch: 7, epoch: 8, status: "closed" });
    assert.throws(() => prepareWhatsAppClose(scope, closedBinding, closedTicket, actor, 6, "closed"));
    assert.throws(() => prepareWhatsAppClose(scope, closedBinding, closedTicket, actor, 8, "resolved"));
    assert.throws(() => prepareWhatsAppClose(scope, { ...closedBinding, mode: "waiting_human", ticketId: "new-ticket", epoch: 9 }, closedTicket, actor, 7, "closed"), /whatsapp_case_not_found/);
  });
  await t.test("admits a resumed notice only in the same current AI epoch and active session", () => {
    assert.equal(currentResumeCase(authority, closedBinding, closedTicket, session), true);
    for (const current of [{ ...closedBinding, mode: "waiting_human" as const, ticketId: "new-ticket", epoch: 9 }, { ...closedBinding, epoch: 10 }, { ...closedBinding, configId: "rotated" }])
      assert.equal(currentResumeCase(authority, current, closedTicket, session), false);
    for (const current of [{ ...session, status: "expired" }, { ...session, id: "new-session" }, { ...session, buyerPhone: "+5511888888888" }, { ...session, deviceId: "other-device" }])
      assert.equal(currentResumeCase(authority, closedBinding, closedTicket, current), false);
  });
  await t.test("keeps resumed notice identity separate from every operator-message receipt", () => {
    assert.equal(whatsappResumeDeliveryId("binding-a", 8), "support_resume:binding-a:8");
    assert.equal(whatsappResumeDeliveryId("binding-a", 8).startsWith("support_message:"), false);
    assert.notEqual(whatsappResumeDeliveryId("binding-a", 8), whatsappResumeDeliveryId("binding-a", 10));
  });
  await t.test("persists truthful no-start failure without blocking an authorized case close", () => {
    assert.deepEqual(prepareWhatsAppClose(scope, binding, ticket, actor, 7, "closed"), { replay: false, previousEpoch: 7, epoch: 8, status: "closed" });
    assert.deepEqual(initialResumeDelivery("unavailable"), { status: "failed", revision: 0, providerMessageId: null, errorCode: "channel_identity_unavailable" });
    assert.equal(currentResumeCase({ ...authority, identityStatus: "unavailable", accountId: null }, closedBinding, closedTicket, session), false);
    assert.equal(currentResumeCase({ ...authority, identityStatus: "unavailable", accountId: "later-connected-account" }, closedBinding, closedTicket, session), false);
    assert.deepEqual(initialResumeDelivery("available"), { status: "queued", revision: 0, providerMessageId: null });
  });
  await t.test("fixes readable robot-marked copy before durable digest, replay and send", () => {
    assert.equal(WHATSAPP_RESUME_TEXT, "🤖 *Atendimento humano concluído*\n\nA assistente virtual está disponível novamente.\nSeu carrinho continua preservado.");
  });
  await t.test("only an exact exclusive resume event can carry the original epoch transition", () => {
    const event = { eventId: "event-a", eventType: WHATSAPP_RESUME_REQUESTED, merchantId: "merchant-a", schemaVersion: 1,
      deliveryLeaseToken: "lease-a", correlationId: "support_resume:binding-a:8", causationId: "message-a",
      payload: { messageId: "message-a", ticketId: "ticket-a", bindingId: "binding-a", previousEpoch: 7, epoch: 8 } };
    const proof = parseResumeDispatch(event);assert.ok(proof);
    assert.equal(proof.deliveryId,"support_resume:binding-a:8");assert.equal(proof.previousEpoch,7);assert.equal(proof.epoch,8);
    for (const invalid of [{ ...event, eventType: "whatsapp.support.message.requested" }, { ...event, deliveryLeaseToken: undefined },
      { ...event, correlationId: "support_message:message-a" }, { ...event, causationId: "other-message" },
      { ...event, payload: { ...event.payload, epoch: 9 } }, { ...event, payload: { ...event.payload, accountId: "body-grant" } }])
      assert.equal(parseResumeDispatch(invalid),undefined);
  });
  await t.test("fresh durable lease, producer and payload are required independently of event parsing", () => {
    const now = new Date("2026-11-17T10:00:00Z"),payload={messageId:"message-a",ticketId:"ticket-a",bindingId:"binding-a",previousEpoch:7,epoch:8};
    const event={eventId:"event-a",eventType:WHATSAPP_RESUME_REQUESTED,merchantId:"merchant-a",schemaVersion:1,
      deliveryLeaseToken:"lease-a",correlationId:"support_resume:binding-a:8",causationId:"message-a",payload};
    const proof=parseResumeDispatch(event);assert.ok(proof);
    const row={...event,producer:"support",status:"processing",leaseToken:"lease-a",leaseExpiresAt:new Date(now.getTime()+1000)};
    assert.equal(ownsResumeDispatch(proof,row,now),true);
    for(const invalid of [null,{...row,merchantId:"foreign"},{...row,producer:"other"},{...row,status:"delivered"},
      {...row,eventType:"whatsapp.support.message.requested"},{...row,leaseToken:"new-claim"},{...row,leaseExpiresAt:now},
      {...row,payload:{...payload,ticketId:"other-ticket"}}])assert.equal(ownsResumeDispatch(proof,invalid,now),false);
  });
});
