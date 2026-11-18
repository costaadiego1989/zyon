import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { isSupportTicketStatus } from "../domain/entities/support-ticket.entity.js";
import { decodeSupportTicketCursor, encodeSupportTicketCursor } from "../domain/ports/support-ticket-repository.port.js";
import { publicConversationMessage } from "./whatsapp-conversation-projection.js";

const requireHuman = (principal: TenantPrincipal) => {
  if (principal.kind !== "human" || !["owner", "admin", "staff"].includes(principal.role)) throw new ForbiddenException("human_operator_required");
};
const identifier = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= 191;
function options(input: unknown, withStatus: boolean) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !(withStatus ? ["limit", "cursor", "status"] : ["limit", "cursor"]).includes(key))) throw new BadRequestException("invalid_whatsapp_queue_query");
  const raw = input as Record<string, unknown>, limit = raw.limit === undefined ? 50 : typeof raw.limit === "string" && /^\d{1,3}$/.test(raw.limit) ? Number(raw.limit) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || raw.status !== undefined && (typeof raw.status !== "string" || !isSupportTicketStatus(raw.status))) throw new BadRequestException("invalid_whatsapp_queue_query");
  let after: { createdAt: Date; id: string } | undefined;
  if (raw.cursor !== undefined) {
    if (typeof raw.cursor !== "string" || !raw.cursor || raw.cursor.length > 512) throw new BadRequestException("invalid_whatsapp_queue_cursor");
    const decoded = decodeSupportTicketCursor(raw.cursor), date = decoded ? new Date(decoded.createdAt) : null;
    if (!decoded || !identifier(decoded.id) || !date || !Number.isFinite(date.getTime()) || date.toISOString() !== decoded.createdAt
      || encodeSupportTicketCursor(decoded.createdAt, decoded.id) !== raw.cursor) throw new BadRequestException("invalid_whatsapp_queue_cursor");
    after = { createdAt: date, id: decoded.id };
  }
  return { limit, after, status: raw.status as "open" | "in_progress" | "closed" | "resolved" | undefined };
}

/** UNEXECUTED cache candidate. Every query derives tenant from the verified
 * principal and fixes source=whatsapp on the server, including message joins. */
@Injectable()
export class ReadWhatsAppConversationsUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async list(principal: TenantPrincipal, input: unknown) {
    requireHuman(principal);const { limit, after, status } = options(input, true), merchantId = principal.tenantId;
    return this.prisma.$transaction(async tx => {
    const rows = await tx.supportTicket.findMany({ where: { merchantId, source: "whatsapp", mergedIntoId: null, ...(status ? { status } : {}),
      ...(after ? { OR: [{ updatedAt: { lt: after.createdAt } }, { updatedAt: after.createdAt, id: { lt: after.id } }] } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit + 1 });
    const visible = rows.slice(0, limit), ids = visible.map(row => row.id);
    const bindings = ids.length ? await tx.whatsAppHandoffBinding.findMany({ where: { merchantId, ticketId: { in: ids } }, select: {
      id: true, ticketId: true, mode: true, epoch: true, assignedOperatorId: true,
    } }) : [];
    const data = visible.map(row => ({ id: row.id, status: row.status, buyerMessage: row.buyerMessage,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), binding: bindings.find(item => item.ticketId === row.id) ?? null }));
    const last = visible.at(-1);return { data, has_more: rows.length > limit, next_cursor: rows.length > limit && last ? encodeSupportTicketCursor(last.updatedAt.toISOString(), last.id) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async detail(principal: TenantPrincipal, ticketId: string, input: unknown) {
    requireHuman(principal);if (!identifier(ticketId)) throw new BadRequestException("invalid_whatsapp_ticket");
    const { limit, after } = options(input, false), merchantId = principal.tenantId;
    return this.prisma.$transaction(async tx => {
    const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, merchantId, source: "whatsapp", mergedIntoId: null } });
    if (!ticket) throw new NotFoundException("whatsapp_case_not_found");
    const binding = await tx.whatsAppHandoffBinding.findFirst({ where: { merchantId, ticketId }, select: {
      id: true, ticketId: true, mode: true, epoch: true, assignedOperatorId: true, configId: true, whatsappSessionId: true,
    } });
    const channel = binding ? await tx.whatsAppChannelConfig.findFirst({ where: { id: binding.configId, merchantId }, select: { id: true, provider: true, status: true, enabled: true } }) : null;
    const rows = await tx.supportTicketMessage.findMany({ where: { ticketId, ticket: { merchantId, source: "whatsapp", mergedIntoId: null },
      ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1 });
    const visible = rows.slice(0, limit), last = visible.at(-1);
    return { ticket: { id: ticket.id, status: ticket.status, buyerMessage: ticket.buyerMessage, createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString() },
      binding, channel, messages: visible.map(message => publicConversationMessage(message, ticketId)),
      has_more: rows.length > limit, next_cursor: rows.length > limit && last ? encodeSupportTicketCursor(last.createdAt.toISOString(), last.id) : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
