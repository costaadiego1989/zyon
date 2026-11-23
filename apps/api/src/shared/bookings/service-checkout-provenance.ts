import { ConflictException, UnauthorizedException } from "@nestjs/common";
import type { Cart } from "@zyon/shared-types";
import { createHash } from "node:crypto";
import { canonicalJson } from "../http/canonical-json.js";
import type { StorefrontCartCommercialSnapshot } from "../../modules/storefront/domain/ports/storefront-cart.port.js";
import { paymentCartFingerprint } from "../../modules/checkout/domain/services/payment-cart-fingerprint.js";
import type { TrustedCheckoutBuyer, TrustedWhatsAppCheckoutBuyer } from "../../modules/checkout/application/services/trusted-checkout-buyer.js";

import { assertNativeServiceBookingAdmission } from "./native-service-booking-authority.js";

type Scope = { merchantId: string; sessionId: string; globalUserId: string };
/** Request admission only. Constructed from verified embed + buyer credentials,
 * outside every public body. It does not expire a stored booking or payment. */
export interface ServiceCheckoutBookingCapability extends Scope {
  /** Embed always supplies an origin. Native admission requires the private verified execution instead. */
  allowedOrigin?: string;
  cartRef?: string;
  expiresAtUnix: number;
  /** Set by the booking orchestrator before asynchronous Start resolution. */
  cartFingerprint?: string;
  storefrontCartRef?: string;
  parentCartFingerprint?: string;
  /** Only the authenticated existing /embed/start review action may set this. */
  leaseIntent?: "review_checkout";
}
export function serviceBookingParentFingerprint(cart: StorefrontCartCommercialSnapshot): string {
  return createHash("sha256").update(canonicalJson({ items: cart.items, total: cart.total, discount: cart.discount,
    couponCode: cart.couponCode, freeShipping: cart.freeShipping })).digest("hex");
}
export function assertServiceCheckoutCreationCapability(scope: Scope & { cart?: Cart }, capability: ServiceCheckoutBookingCapability | undefined, now: Date): void {
  if (!capability) return;
  let origin: string | undefined;
  if (capability.allowedOrigin === undefined) {
    try { assertNativeServiceBookingAdmission(capability, now); } catch { throw new UnauthorizedException("service_booking_capability_invalid"); }
  } else try { origin = new URL(capability.allowedOrigin).origin; } catch { throw new UnauthorizedException("service_booking_capability_invalid"); }
  if (capability.merchantId !== scope.merchantId || capability.sessionId !== scope.sessionId || capability.globalUserId !== scope.globalUserId
    || ![scope.merchantId, scope.sessionId, scope.globalUserId].every(value => typeof value === "string" && value.length > 0 && value.length <= 191 && value.trim() === value)
    || origin !== capability.allowedOrigin || !Number.isSafeInteger(capability.expiresAtUnix) || capability.expiresAtUnix <= 0
    || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new UnauthorizedException("service_booking_capability_invalid");
  if (now.getTime() >= capability.expiresAtUnix * 1000) throw new UnauthorizedException("embed_session_token_expired");
  if ((capability.storefrontCartRef === undefined) !== (capability.parentCartFingerprint === undefined)
    || capability.storefrontCartRef !== undefined && (!capability.storefrontCartRef || capability.storefrontCartRef.length > 191
      || capability.storefrontCartRef.trim() !== capability.storefrontCartRef || !/^[a-f0-9]{64}$/.test(capability.parentCartFingerprint!)))
    throw new UnauthorizedException("service_booking_capability_invalid");
  if (capability.leaseIntent !== undefined && capability.leaseIntent !== "review_checkout") throw new UnauthorizedException("service_booking_capability_invalid");
  if (capability.cartFingerprint !== undefined && (!/^[a-f0-9]{64}$/.test(capability.cartFingerprint)
    || !scope.cart || paymentCartFingerprint({ cart: scope.cart }) !== capability.cartFingerprint)) throw new ConflictException("service_booking_cart_changed");
}
export interface ServiceCheckoutCreationIdentity {
  /** Actual server entrypoint, outside public checkout/cart DTOs. */
  serverChannel?: "storefront" | "whatsapp";
  trustedBuyer?: TrustedCheckoutBuyer;
  trustedWhatsAppBuyer?: TrustedWhatsAppCheckoutBuyer;
  bookingCapability?: ServiceCheckoutBookingCapability;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function serviceCheckoutProvenance(scope: Scope, identity?: ServiceCheckoutCreationIdentity) {
  if (!identity?.serverChannel) return undefined;
  if ([scope.merchantId, scope.sessionId, scope.globalUserId].some(v => typeof v !== "string" || !v || v.trim() !== v || v.length > 191))
    throw new UnauthorizedException("service_checkout_origin_binding_invalid");
  if (!["storefront", "whatsapp"].includes(identity.serverChannel)) throw new UnauthorizedException("service_checkout_origin_invalid");
  if (identity.trustedBuyer && identity.trustedWhatsAppBuyer) throw new UnauthorizedException("service_checkout_origin_ambiguous");
  const binding = { merchantId: scope.merchantId, sessionId: scope.sessionId, globalUserId: scope.globalUserId };
  const whatsapp = identity.trustedWhatsAppBuyer;
  if (whatsapp) {
    if (identity.serverChannel !== "whatsapp" || whatsapp.merchantId !== scope.merchantId || whatsapp.globalUserId !== scope.globalUserId
      || !whatsapp.conversationId || !whatsapp.customer.phone || whatsapp.customer.phone_verified !== true || whatsapp.customer.email_verified !== false)
      throw new UnauthorizedException("service_checkout_origin_binding_invalid");
    return { serviceOrigin: "whatsapp" as const, serviceOriginProof: { schemaVersion: 1, ...binding,
      authority: "durable_whatsapp_buyer", conversationId: whatsapp.conversationId } };
  }
  const buyer = identity.trustedBuyer;
  if (buyer && (buyer.globalUserId !== scope.globalUserId || !buyer.customer.email || buyer.customer.email_verified !== true))
    throw new UnauthorizedException("service_checkout_origin_binding_invalid");
  return { serviceOrigin: identity.serverChannel, serviceOriginProof: { schemaVersion: 1, ...binding,
    authority: identity.serverChannel === "whatsapp" ? "canonical_whatsapp_entrypoint" : "storefront_entrypoint" } };
}
/** Historical channel only. A changed buyer must still prove its own identity;
 * this receipt never grants buyer, payment, appointment or lease authority. */
export function readStoredServiceOrigin(row: Scope & { serviceOrigin?: string | null; serviceOriginProof?: unknown; [key: string]: unknown }): "whatsapp" | "storefront" {
  const proof = row.serviceOriginProof;
  if (!object(proof) || proof.schemaVersion !== 1 || proof.merchantId !== row.merchantId || proof.sessionId !== row.sessionId
    || typeof proof.globalUserId !== "string" || !proof.globalUserId
    || !(row.serviceOrigin === "whatsapp" && (proof.authority === "canonical_whatsapp_entrypoint"
      || proof.authority === "durable_whatsapp_buyer" && typeof proof.conversationId === "string" && !!proof.conversationId)
      || row.serviceOrigin === "storefront" && proof.authority === "storefront_entrypoint"))
    throw new ConflictException("service_order_origin_unproven");
  return row.serviceOrigin;
}
