import { createHash } from "node:crypto";
import type { ContactPermissionStatus } from "@zyon/shared-types";
import { whatsappE164 } from "../../../whatsapp-channel/domain/services/whatsapp-phone.js";

export interface ContactIdentity { kind: "phone" | "email" | "bsuid"; value: string; businessScope: string | null }
export function normalizeContactIdentity(input: { kind: ContactIdentity["kind"]; value: string; businessScope?: string | null }): ContactIdentity {
  if (typeof input.value !== "string" || !input.value || input.value.length > 320) throw new Error("invalid_contact:value");
  if (input.kind === "phone") {
    const value = whatsappE164(input.value);
    if (!value) throw new Error("invalid_contact:phone");
    return { kind: "phone", value, businessScope: null };
  }
  if (input.kind === "email") {
    const value = input.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("invalid_contact:email");
    return { kind: "email", value, businessScope: null };
  }
  if (input.kind !== "bsuid" || /\s|[\x00-\x1f]/.test(input.value)) throw new Error("invalid_contact:identity");
  if (typeof input.businessScope !== "string" || !input.businessScope || input.businessScope.length > 200) throw new Error("invalid_contact:businessScope");
  return { kind: "bsuid", value: input.value, businessScope: input.businessScope };
}
export function sequenceIdentity(senderBindingId: string, identity: ContactIdentity): string {
  return createHash("sha256").update(JSON.stringify([senderBindingId, identity.kind, identity.businessScope, identity.value])).digest("hex");
}
export function resolveContactAttribution(bindings: { prospectId: string; confirmed: boolean }[]) {
  const confirmed = [...new Set(bindings.filter(b => b.confirmed).map(b => b.prospectId))];
  const all = [...new Set(bindings.map(b => b.prospectId))].sort();
  return confirmed.length === 1 ? { prospectId: confirmed[0], ambiguousBindings: [] as string[] }
    : { prospectId: null, ambiguousBindings: all };
}
export interface ContactAuthorizationScope { senderBindingId: string; endpointId: string; purpose: string }
export interface ContactAuthorization extends ContactAuthorizationScope { source: string; status: ContactPermissionStatus; evidenceRef: string | null; occurredAt: Date }
export function contactPermission(scope: ContactAuthorizationScope, receipts: ContactAuthorization[]): ContactPermissionStatus {
  return receipts.filter(r => r.source === "zyon_platform" && r.senderBindingId === scope.senderBindingId && r.endpointId === scope.endpointId && r.purpose === scope.purpose && (r.status === "revoked" || !!r.evidenceRef))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.status === "revoked" ? -1 : 1))[0]?.status ?? "no_opt_in";
}
