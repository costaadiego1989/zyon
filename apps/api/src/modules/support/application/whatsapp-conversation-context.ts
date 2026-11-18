import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";

export interface WhatsAppConversationContext {
  merchant_id: string;
  user_id: string;
  role: "OWNER" | "ADMIN" | "STAFF";
}

/** Identity projection only. The existing credential guard authenticates the
 * signed session against the current user and membership on every request.
 * This DTO conveys no configuration, plan, channel or command entitlement. */
export function conversationContext(principal: TenantPrincipal, query: unknown = {}): Readonly<WhatsAppConversationContext> {
  if (!query || typeof query !== "object" || Array.isArray(query) || Object.keys(query).length !== 0) {
    throw new BadRequestException("invalid_whatsapp_context_query");
  }
  if (!principal || principal.kind !== "human" || !["owner", "admin", "staff"].includes(principal.role)
    || !principal.tenantId.trim() || !principal.userId.trim()) {
    throw new ForbiddenException("human_operator_required");
  }
  const roles = { owner: "OWNER", admin: "ADMIN", staff: "STAFF" } as const;
  return Object.freeze({ merchant_id: principal.tenantId, user_id: principal.userId, role: roles[principal.role] });
}
