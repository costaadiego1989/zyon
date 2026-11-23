import { UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { currentWhatsAppExecution, type WhatsAppExecution } from "../whatsapp/whatsapp-automation-context.js";
import type { TrustedWhatsAppCheckoutBuyer } from "../../modules/checkout/application/services/trusted-checkout-buyer.js";

/** Private command context, not a token, serialized actor or embed scope. The
 * real durable WhatsApp verifier constructs it for one existing execution. */
export interface NativeServiceBookingScope {
  merchantId: string; sessionId: string; cartRef: string; expiresAtUnix: number;
  buyer: TrustedWhatsAppCheckoutBuyer;
  allowedOrigin?: undefined;
}
interface NativeAdmission {
  merchantId: string; sessionId: string; globalUserId: string; cartRef?: string; expiresAtUnix: number; allowedOrigin?: string;
  buyer?: TrustedWhatsAppCheckoutBuyer;
}
interface NativeFrame {
  scope: NativeServiceBookingScope;
  execution: Readonly<WhatsAppExecution>;
  gesture?: "continue" | "confirm";
  /** Verify original inbox/config/lease/phone owner using the actual tx clock.
   * No callback is accepted from a public DTO, model or persisted JSON. */
  revalidate(tx: Prisma.TransactionClient): Promise<Date>;
}
const storage = new AsyncLocalStorage<Readonly<NativeFrame>>();
const deny = () => new UnauthorizedException("service_booking_native_authority_required");
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 191 && value.trim() === value;
function freezeData(value: object): void { for (const child of Object.values(value)) if (child && typeof child === "object") freezeData(child); Object.freeze(value); }

export function withNativeServiceBookingAuthority<T>(frame: NativeFrame, work: () => T): T {
  const execution = currentWhatsAppExecution(), scope = frame.scope;
  if (!execution || execution.authority.provider !== "META_CLOUD" || frame.execution !== execution || typeof frame.revalidate !== "function"
    || execution.authority.merchantId !== scope.merchantId || execution.authority.conversationId !== scope.cartRef
    || ![scope.merchantId, scope.sessionId, scope.cartRef, scope.buyer.globalUserId].every(validId)
    || scope.buyer.merchantId !== scope.merchantId || scope.buyer.conversationId !== scope.cartRef
    || scope.buyer.customer.phone_verified !== true || scope.buyer.customer.email_verified !== false
    || scope.buyer.customer.phone.replace(/\D/g, "") !== execution.authority.buyerPhone.replace(/\D/g, "")
    || !Number.isSafeInteger(scope.expiresAtUnix) || scope.expiresAtUnix <= 0 || scope.allowedOrigin !== undefined) throw deny();
  const active = storage.getStore(); if (active) throw deny();
  const bound = structuredClone(scope);
  freezeData(bound);
  return storage.run(Object.freeze({ ...frame, scope: bound }), work);
}

/** Snapshot clones retain ordinary identity/fingerprint data, while authority
 * remains in this non-serializable private context and the original execution. */
export function assertNativeServiceBookingAdmission(input: NativeAdmission, now: Date): void {
  const frame = storage.getStore(), original = currentWhatsAppExecution();
  if (!frame || frame.execution !== original || input.allowedOrigin !== undefined
    || input.merchantId !== frame.scope.merchantId || input.sessionId !== frame.scope.sessionId
    || input.globalUserId !== frame.scope.buyer.globalUserId || input.cartRef !== frame.scope.cartRef
    || input.buyer !== undefined && !isDeepStrictEqual(input.buyer, frame.scope.buyer)
    || !Number.isSafeInteger(input.expiresAtUnix) || input.expiresAtUnix > frame.scope.expiresAtUnix
    || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw deny();
  if (now.getTime() >= input.expiresAtUnix * 1000) throw new UnauthorizedException("whatsapp_service_authority_expired");
}

export function assertNativeServiceBookingGesture(scope: NativeServiceBookingScope, gesture: "continue" | "confirm"): void {
  const frame = storage.getStore();
  assertNativeServiceBookingAdmission({ ...scope, globalUserId: scope.buyer.globalUserId }, new Date(0));
  if (!frame || frame.gesture !== gesture) throw new UnauthorizedException("whatsapp_service_button_required");
}

/** Only INITIAL native request admission opts in. Persisted checkout/hold/
 * payment provenance and later provider webhooks do not require this frame. */
export async function revalidateNativeServiceBookingAdmission(tx: Prisma.TransactionClient,
  input: NativeAdmission | undefined): Promise<Date | undefined> {
  if (!input || input.allowedOrigin !== undefined) return;
  const frame = storage.getStore(); if (!frame || frame.execution !== currentWhatsAppExecution()) throw deny();
  // Validate identity before a caller can touch another tenant in the callback.
  assertNativeServiceBookingAdmission(input, new Date(0));
  const now = await frame.revalidate(tx); assertNativeServiceBookingAdmission(input, now); return now;
}
