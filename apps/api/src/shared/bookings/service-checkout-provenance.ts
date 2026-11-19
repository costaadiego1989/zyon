import { ConflictException, UnauthorizedException } from "@nestjs/common";
import type { TrustedCheckoutBuyer, TrustedWhatsAppCheckoutBuyer } from "../../modules/checkout/application/services/trusted-checkout-buyer.js";

type Scope = { merchantId: string; sessionId: string; globalUserId: string };
export interface ServiceCheckoutCreationIdentity {
  /** Actual server entrypoint, outside public checkout/cart DTOs. */
  serverChannel?: "storefront" | "whatsapp";
  trustedBuyer?: TrustedCheckoutBuyer;
  trustedWhatsAppBuyer?: TrustedWhatsAppCheckoutBuyer;
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
