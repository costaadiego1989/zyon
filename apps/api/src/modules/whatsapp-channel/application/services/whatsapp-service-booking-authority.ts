import { UnauthorizedException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { decryptPii, isPiiEncrypted } from "../../../../shared/crypto/pii-cipher.service.js";
import { isDeepStrictEqual } from "node:util";
import { currentWhatsAppExecution, admitWhatsAppEffectInTransaction } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { withNativeServiceBookingAuthority, type NativeServiceBookingScope } from "../../../../shared/bookings/native-service-booking-authority.js";
import { withNativePublicServiceReadScope, revalidateNativePublicServiceReadScope, type NativePublicServiceReadScope } from "../../../../shared/bookings/native-public-service-read-scope.js";
import { executionClock } from "../../../revenue-manager/infrastructure/strategy-execution-ledger.js";
import { readStoredServiceOrigin } from "../../../../shared/bookings/service-checkout-provenance.js";
import type { ServiceSlotHoldsService } from "../../../../shared/bookings/service-slot-holds.service.js";
import { toCheckoutSession } from "../../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { WhatsAppTurnContext, type VerifiedWhatsAppTurn } from "../../domain/services/whatsapp-turn-context.js";
import type { WhatsAppConversationState } from "../../domain/ui/meta-ui.types.js";
import { checkServiceControlFreshness } from "../../domain/ui/service-booking-controls.js";
import { WhatsAppCheckoutIdentityService, brazilianPhoneForms, type VerifiedWhatsAppOwner } from "./whatsapp-checkout-identity.service.js";

export interface NativeServiceDispatchInput {
  merchantId: string; state: WhatsAppConversationState;
  verifiedSender: { inboxId: string; leaseToken: string; deviceId: string; fromNumber: string };
  action?: unknown;
}
export interface NativeServiceDispatchContext {
  readonly readOnly?: false;
  scope: NativeServiceBookingScope;
  state: WhatsAppConversationState;
  uiBinding: { merchantId: string; configId: string; whatsappSessionId: string; conversationId: string; validUntil: number };
  turn: Readonly<VerifiedWhatsAppTurn>;
  now: Date;
}
export interface NativePublicServiceDispatchContext extends Omit<NativeServiceDispatchContext, "scope" | "readOnly"> {
  readonly readOnly: true;
  readonly scope: NativePublicServiceReadScope;
}
export type NativeServiceReadDispatchContext = NativeServiceDispatchContext | NativePublicServiceDispatchContext;

const deny = () => new UnauthorizedException("whatsapp_service_authority_required");
const decodedAccountPhone = (value: string | null | undefined): string | undefined => {
  if (!value) return; try { return isPiiEncrypted(value) ? decryptPii(value) : value; } catch { return; }
};
const record = (value: unknown): Record<string, any> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;

/** Reuses the existing authenticated turn, AI dispatch frame and phone-buyer
 * recognizer. No public caller can supply an actor, origin, nonce or verifier. */
export class WhatsAppServiceBookingAuthority {
  constructor(private readonly prisma: PrismaClient, private readonly turns: WhatsAppTurnContext,
    private readonly identity: WhatsAppCheckoutIdentityService, private readonly holds: ServiceSlotHoldsService) {}

  /** Public discovery is admitted by the signed Meta turn, not account choice.
   * An existing checkout or resolved owner still uses the original private path.
   * Real authority failures propagate; only absent/ambiguous buyers may browse. */
  async runRead<T>(input: NativeServiceDispatchInput, work: (context: NativeServiceReadDispatchContext) => Promise<T>): Promise<T | undefined> {
    const turn = this.turns.current(), execution = currentWhatsAppExecution(), proof = input.verifiedSender;
    const command = input.action === undefined ? undefined : structuredClone(input.action);
    if (!turn || !execution || !proof || execution.authority.provider !== "META_CLOUD"
      || input.merchantId !== turn.scope.merchantId || execution.authority.merchantId !== turn.scope.merchantId
      || execution.authority.whatsappSessionId !== turn.scope.whatsappSessionId || execution.authority.configId !== turn.scope.configId
      || turn.inboxId !== proof.inboxId || turn.leaseToken !== proof.leaseToken || execution.authority.inboxId !== turn.inboxId
      || proof.deviceId !== "META_CLOUD:" + turn.scope.configId || execution.authority.deviceId !== proof.deviceId
      || turn.conversationId !== input.state.conversationId || execution.authority.conversationId !== turn.conversationId
      || execution.authority.buyerPhone.replace(/\D/g, "") !== proof.fromNumber.replace(/\D/g, "")
      || ["continue", "confirm"].includes(String(record(command)?.operation))) throw deny();
    let originalExpiry = 0, uiDeadline = 0, checkoutId: string | null | undefined;
    let currentState: WhatsAppConversationState | undefined;
    const verify = async (tx: Prisma.TransactionClient) => {
      if (currentWhatsAppExecution() !== execution || this.turns.current() !== turn) throw deny();
      await admitWhatsAppEffectInTransaction(tx, turn.scope.merchantId);
      const now = await executionClock(tx);
      const [inbox, config, session] = await Promise.all([
        tx.whatsAppWebhookInbox.findFirst({ where: { id: turn.inboxId, merchantId: turn.scope.merchantId, configId: turn.scope.configId,
          deviceId: proof.deviceId, kind: "message", status: "processing", leaseToken: turn.leaseToken } }),
        tx.whatsAppChannelConfig.findFirst({ where: { id: turn.scope.configId, merchantId: turn.scope.merchantId,
          provider: "META_CLOUD", enabled: true, status: "ACTIVE" } }),
        tx.whatsAppSession.findFirst({ where: { id: turn.scope.whatsappSessionId, merchantId: turn.scope.merchantId, deviceId: proof.deviceId, status: "active" } }),
      ]);
      const payload = record(inbox?.payload), state = record(session?.conversationState), phone = proof.fromNumber.replace(/\D/g, "");
      if (!inbox?.leaseExpiresAt || inbox.leaseExpiresAt <= now || !config || !session
        || state?.conversationId !== turn.conversationId || state.revision !== execution.authority.revision
        || !brazilianPhoneForms(session.buyerPhone).includes(phone)
        || payload?.merchantId !== turn.scope.merchantId || payload.deviceId !== proof.deviceId || payload.provider !== "META_CLOUD"
        || payload.fromNumber?.replace(/\D/g, "") !== phone || typeof payload.timestamp !== "number" || !Number.isFinite(payload.timestamp)
        || payload.timestamp > now.getTime() + 60_000 || now.getTime() - payload.timestamp > 24 * 60 * 60_000
        || session.lastActivityAt.getTime() + 24 * 60 * 60_000 <= now.getTime()) throw deny();
      if (command !== undefined && !checkServiceControlFreshness({ action: command, state: state as WhatsAppConversationState, turn, now }).ok) throw deny();
      if (checkoutId === undefined) checkoutId = session.checkoutSessionId;
      else if (checkoutId !== session.checkoutSessionId) throw deny();
      const expires = Math.floor(inbox.leaseExpiresAt.getTime() / 1000);
      if (originalExpiry === 0) originalExpiry = expires;
      if (now.getTime() >= originalExpiry * 1000) throw deny();
      currentState = structuredClone(state) as WhatsAppConversationState;
      uiDeadline = Math.min(payload.timestamp + 24 * 60 * 60_000, session.lastActivityAt.getTime() + 24 * 60 * 60_000);
      return now;
    };
    const verifiedAt = await this.prisma.$transaction(verify);
    // Preserve recognized owners and the already-authorized phone-only account
    // bootstrap. Only unresolved ambiguity without a private checkout falls back.
    let privateAdmitted = false;
    const privateResult = await this.run(input, context => { privateAdmitted = true; return work(context); });
    if (privateAdmitted || checkoutId) return privateResult;
    const emailHint = await this.identity.emailHint(turn.scope.merchantId, { globalUserId: "", phone: proof.fromNumber });
    const recognition = await this.identity.recognize({ merchantId: turn.scope.merchantId, conversationId: turn.conversationId,
      phone: proof.fromNumber, ...(typeof emailHint === "string" ? { emailHint } : {}), verifiedSender: proof });
    if (!recognition.owner || recognition.owner.merchantId !== turn.scope.merchantId || recognition.owner.conversationId !== turn.conversationId
      || recognition.owner.phone.replace(/\D/g, "") !== proof.fromNumber.replace(/\D/g, "")) throw deny();
    if (recognition.status !== "ambiguous") return;
    return withNativePublicServiceReadScope({ scope: { transport: "whatsapp", merchantId: turn.scope.merchantId, expiresAtUnix: originalExpiry },
      execution, revalidate: verify }, async scope => {
      await this.prisma.$transaction(tx => revalidateNativePublicServiceReadScope(tx, scope));
      const value = await work({ readOnly: true, scope, state: structuredClone(currentState!), turn, now: new Date(verifiedAt.getTime()),
        uiBinding: { ...turn.scope, conversationId: turn.conversationId, validUntil: uiDeadline } });
      await this.prisma.$transaction(tx => revalidateNativePublicServiceReadScope(tx, scope));
      return value;
    });
  }

  async run<T>(input: NativeServiceDispatchInput, work: (context: NativeServiceDispatchContext) => Promise<T>): Promise<T | undefined> {
    const turn = this.turns.current(), execution = currentWhatsAppExecution(), proof = input.verifiedSender;
    const command = input.action === undefined ? undefined : structuredClone(input.action);
    if (!turn || !execution || !proof || execution.authority.provider !== "META_CLOUD"
      || input.merchantId !== turn.scope.merchantId || execution.authority.merchantId !== turn.scope.merchantId
      || execution.authority.whatsappSessionId !== turn.scope.whatsappSessionId || execution.authority.configId !== turn.scope.configId
      || turn.inboxId !== proof.inboxId || turn.leaseToken !== proof.leaseToken || execution.authority.inboxId !== turn.inboxId
      || proof.deviceId !== "META_CLOUD:" + turn.scope.configId || execution.authority.deviceId !== proof.deviceId
      || turn.conversationId !== input.state.conversationId || execution.authority.conversationId !== turn.conversationId
      || execution.authority.buyerPhone.replace(/\D/g, "") !== proof.fromNumber.replace(/\D/g, "")) throw deny();
    // Account/email hints are read from the phone-owned current checkout only.
    // Route buyer IDs and model/UI state never identify the account.
    const canonical = await this.prisma.whatsAppSession.findFirst({ where: { id: turn.scope.whatsappSessionId,
      merchantId: turn.scope.merchantId, deviceId: proof.deviceId, status: "active" } });
    const currentState = record(canonical?.conversationState);
    if (!canonical || currentState?.conversationId !== turn.conversationId || currentState.revision !== execution.authority.revision) throw deny();
    const currentCheckout = canonical.checkoutSessionId ? await this.prisma.checkoutSession.findUnique({ where: {
      merchantId_sessionId: { merchantId: turn.scope.merchantId, sessionId: canonical.checkoutSessionId } } }) : undefined;
    const previousCart = record(currentCheckout?.cart), previousCustomer = record(currentCheckout?.customer);
    const emailHint = currentCheckout && previousCart?.cart_ref === turn.conversationId && previousCustomer?.phone_verified === true
      && previousCustomer.phone?.replace(/\D/g, "") === proof.fromNumber.replace(/\D/g, "") ? previousCustomer.email
      : await this.identity.emailHint(turn.scope.merchantId, { globalUserId: "", phone: proof.fromNumber });
    let recognition = await this.identity.recognize({ merchantId: turn.scope.merchantId, conversationId: turn.conversationId,
      phone: proof.fromNumber, ...(typeof emailHint === "string" ? { emailHint } : {}), verifiedSender: proof });
    if (!recognition.owner) return;
    const matchesOwner = (owner: VerifiedWhatsAppOwner | undefined): owner is VerifiedWhatsAppOwner => !!owner && owner.merchantId === turn.scope.merchantId
      && owner.conversationId === turn.conversationId && owner.phone.replace(/\D/g, "") === proof.fromNumber.replace(/\D/g, "");
    if (!matchesOwner(recognition.owner)) throw deny();
    if (recognition.status === "unrecognized") {
      // Reuse the existing phone-only account writer with the CANONICAL route
      // binding. No caller/model buyer ID or supplied profile identifies it.
      const binding = await this.prisma.buyerIdentity.findUnique({ where: { merchantId_identityKey: {
        merchantId: turn.scope.merchantId, identityKey: "phone:" + recognition.owner.phone } } });
      if (!binding?.globalUserId) throw deny();
      const account = await this.identity.ensurePhoneOnlyHubAccount({ owner: recognition.owner, globalUserId: binding.globalUserId });
      if (account) recognition = await this.identity.recognize({ merchantId: turn.scope.merchantId, conversationId: turn.conversationId,
        phone: proof.fromNumber, verifiedSender: proof });
      if (!matchesOwner(recognition.owner)) throw deny();
    }
    let buyer = recognition.status === "recognized" ? structuredClone(recognition.buyer) : undefined;
    // Preserve an existing canonical phone-owned guest checkout even if the
    // phone later becomes associated with another registered account. Never
    // reassign its payment or global buyer from route/model recognition hints.
    if (currentCheckout && previousCart?.cart_ref === turn.conversationId && previousCustomer?.phone_verified === true
      && previousCustomer.phone?.replace(/\D/g, "") === proof.fromNumber.replace(/\D/g, "") && readStoredServiceOrigin(currentCheckout) === "whatsapp") {
      const account = await this.prisma.buyerAccount.findUnique({ where: { globalUserId: currentCheckout.globalUserId } });
      const phone = decodedAccountPhone(account?.phone);
      if (!account || !phone || !brazilianPhoneForms(phone).includes(proof.fromNumber.replace(/\D/g, ""))) throw deny();
      buyer = { merchantId: turn.scope.merchantId, conversationId: turn.conversationId, globalUserId: account.globalUserId,
        customer: { ...previousCustomer, phone: proof.fromNumber.replace(/\D/g, ""), phone_verified: true, email_verified: false } };
    }
    if (!buyer) return;
    const verifiedBuyer = buyer;
    const committed = !!currentCheckout && await this.holds.isCommittedCheckout(toCheckoutSession(currentCheckout));
    const newBooking = committed && record(command)?.operation !== "confirm";
    const sessionId = !newBooking && canonical.checkoutSessionId ? canonical.checkoutSessionId
      : "wa_checkout_" + createHash("sha256").update(JSON.stringify(["native-service-checkout-v1", canonical.id,
        turn.conversationId, buyer.globalUserId, Number.isSafeInteger(currentState.checkoutGeneration) ? currentState.checkoutGeneration : 0,
        newBooking ? currentCheckout!.sessionId : null])).digest("hex").slice(0, 32);
    let originalExpiry = 0, uiDeadline = 0, gesture: "continue" | "confirm" | undefined;
    const verify = async (tx: Prisma.TransactionClient) => {
      // The existing fence takes its original locks before booking merchant/
      // professional/cart locks. The actual writer transaction is enlisted.
      if (currentWhatsAppExecution() !== execution || this.turns.current() !== turn) throw deny();
      await admitWhatsAppEffectInTransaction(tx, turn.scope.merchantId);
      const now = await executionClock(tx);
      const [inbox, config, session, account] = await Promise.all([
        tx.whatsAppWebhookInbox.findFirst({ where: { id: turn.inboxId, merchantId: turn.scope.merchantId, configId: turn.scope.configId,
          deviceId: proof.deviceId, kind: "message", status: "processing", leaseToken: turn.leaseToken } }),
        tx.whatsAppChannelConfig.findFirst({ where: { id: turn.scope.configId, merchantId: turn.scope.merchantId,
          provider: "META_CLOUD", enabled: true, status: "ACTIVE" } }),
        tx.whatsAppSession.findFirst({ where: { id: turn.scope.whatsappSessionId, merchantId: turn.scope.merchantId, deviceId: proof.deviceId, status: "active" } }),
        tx.buyerAccount.findUnique({ where: { globalUserId: verifiedBuyer.globalUserId } }),
      ]);
      const payload = record(inbox?.payload), state = record(session?.conversationState), phone = proof.fromNumber.replace(/\D/g, ""), accountPhone = decodedAccountPhone(account?.phone);
      if (!inbox?.leaseExpiresAt || inbox.leaseExpiresAt <= now || !config || !session || !account || !accountPhone
        || state?.conversationId !== turn.conversationId || state.revision !== execution.authority.revision
        || !brazilianPhoneForms(session.buyerPhone).includes(phone) || !brazilianPhoneForms(accountPhone).includes(phone)
        || payload?.merchantId !== turn.scope.merchantId || payload.deviceId !== proof.deviceId || payload.provider !== "META_CLOUD"
        || payload.fromNumber?.replace(/\D/g, "") !== phone || typeof payload.timestamp !== "number" || !Number.isFinite(payload.timestamp)
        || payload.timestamp > now.getTime() + 60_000 || now.getTime() - payload.timestamp > 24 * 60 * 60_000
        || session.lastActivityAt.getTime() + 24 * 60 * 60_000 <= now.getTime()) throw deny();
      if (command !== undefined) {
        const choice = checkServiceControlFreshness({ action: command, state: state as WhatsAppConversationState, turn, now });
        if (!choice.ok) throw deny();
        const operation = String(choice.action.operation);
        if (operation === "continue" || operation === "confirm") {
          if (turn.origin !== "button" || typeof payload.interactiveId !== "string"
            || !isDeepStrictEqual(record(state.selections)?.[payload.interactiveId], command)) throw deny();
          if (gesture !== undefined && gesture !== operation) throw deny(); gesture = operation;
        }
      }
      const owned = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: turn.scope.merchantId, sessionId } } });
      if (owned) {
        const cart = record(owned.cart), customer = record(owned.customer);
        if (owned.globalUserId !== verifiedBuyer.globalUserId || cart?.cart_ref !== turn.conversationId
          || customer?.phone_verified !== true || customer.phone?.replace(/\D/g, "") !== phone || readStoredServiceOrigin(owned) !== "whatsapp") throw deny();
      } else if (canonical.checkoutSessionId && !newBooking) throw deny();
      const expires = Math.floor(inbox.leaseExpiresAt.getTime() / 1000);
      if (originalExpiry === 0) originalExpiry = expires;
      if (now.getTime() >= originalExpiry * 1000) throw deny();
      uiDeadline = Math.min(payload.timestamp + 24 * 60 * 60_000, session.lastActivityAt.getTime() + 24 * 60 * 60_000);
      return now;
    };
    const verifiedAt = await this.prisma.$transaction(verify);
    const scope: NativeServiceBookingScope = { merchantId: turn.scope.merchantId, sessionId, cartRef: turn.conversationId,
      expiresAtUnix: originalExpiry, buyer };
    return withNativeServiceBookingAuthority({ scope, execution, revalidate: verify, ...(gesture ? { gesture } : {}) }, () => work({ scope,
      state: structuredClone(currentState) as WhatsAppConversationState, turn, now: new Date(verifiedAt.getTime()),
      uiBinding: { ...turn.scope, conversationId: turn.conversationId, validUntil: uiDeadline } }));
  }
}
