import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { SupportTicket, SupportCaseDetail, SupportCaseSummary, SupportCaseMessage, ReturnRequestResult, SupportOrder } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";
import { appendSupportEvent, lockSupportResource, persistSupportMessage } from "../../support/application/support-persistence.js";
import { ReturnOrderService, RETURN_REASON_LABELS, RESOLVED_RETURN_STATUSES, validateReturnItems } from "./return-order.service.js";
import { ReturnAttachmentService } from "./return-attachment.service.js";
import { ProcessRefundUseCase } from "./use-cases/process-refund.use-case.js";
import { AcceptMarketplaceReturnUseCase } from "./use-cases/accept-marketplace-return.use-case.js";

export interface OpenReturnCaseInput {
  merchantId: string; orderId?: string; buyerId: string; reason: string; kind?: "refund" | "exchange";
  notes?: string; requestKey?: string; items: Array<{ variantId: string; quantity: number }>;
  images?: string[];
}
@Injectable()
export class ReturnCaseService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly orders: ReturnOrderService, private readonly photos: ReturnAttachmentService,
    private readonly processRefund: ProcessRefundUseCase, private readonly acceptReturn: AcceptMarketplaceReturnUseCase,
    private readonly capabilities: RealtimeCapabilityService) {}

  private async linkedReturn(ticket: { returnId: string | null; sessionId: string | null; source: string; merchantId: string }) {
    const id = ticket.returnId ?? (ticket.source === "return_request" ? ticket.sessionId : null);
    return id ? this.prisma.return.findFirst({ where: { id, merchantId: ticket.merchantId }, include: { items: true, refund: true } }) : null;
  }

  async open(input: OpenReturnCaseInput): Promise<ReturnRequestResult> {
    if (typeof input.orderId !== "string" || !input.orderId.trim()) throw new BadRequestException("select_order");
    if (!RETURN_REASON_LABELS[input.reason]) throw new BadRequestException("invalid_return_reason");
    if (input.kind && !["refund", "exchange"].includes(input.kind)) throw new BadRequestException("invalid_return_kind");
    if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > 3500)) throw new BadRequestException("invalid_return_description");
    if (input.requestKey !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey)) throw new BadRequestException("invalid_request_key");
    const order = await this.orders.load(input.merchantId, input.orderId, input.buyerId);
    // Resolve an existing case before uploads or eligibility checks. Retries recover its identity.
    const already = await this.prisma.return.findFirst({ where: { merchantId: input.merchantId, buyerId: input.buyerId,
      OR: [{ orderId: order.orderId, status: { notIn: RESOLVED_RETURN_STATUSES as any } }, ...(input.requestKey ? [{ requestKey: input.requestKey }] : [])] }, orderBy: { createdAt: "asc" } });
    if (already) return this.ensureTicket(already.id, true);
    validateReturnItems(order, input.items);
    const attachments = await this.photos.prepare(input.images, input.merchantId, input.buyerId);
    try { return await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `return-order:${input.merchantId}:${order.orderId}`);
      const existing = await tx.return.findFirst({ where: { merchantId: input.merchantId, buyerId: input.buyerId,
        OR: [{ orderId: order.orderId, status: { notIn: RESOLVED_RETURN_STATUSES as any } }, ...(input.requestKey ? [{ requestKey: input.requestKey }] : [])] }, orderBy: { createdAt: "asc" } });
      if (existing) return this.ensureTicketInTransaction(tx, existing, true);
      const freshOrder = await this.orders.load(input.merchantId, order.orderId, input.buyerId, tx);
      validateReturnItems(freshOrder, input.items);
      const ret = await tx.return.create({ data: {
        merchantId: input.merchantId, orderId: order.orderId, buyerId: input.buyerId, reason: input.reason as any,
        kind: input.kind ?? "refund", notes: input.notes?.trim(), requestKey: input.requestKey,
        imageUrls: attachments.map(a => `attachment:${a.id}`), orderSnapshot: freshOrder as unknown as Prisma.InputJsonValue,
        items: { create: input.items.map(it => ({ variantId: it.variantId, quantity: it.quantity })) },
      } });
      const result = await this.ensureTicketInTransaction(tx, ret, false);
      if (attachments.length) await tx.supportAttachment.createMany({ data: attachments.map(a => ({ ...a, ticketId: result.ticketId })) });
      return result;
    }); } finally { await this.photos.discardUnlinked(attachments); }
  }

  private async ensureTicket(returnId: string, existing: boolean) {
    return this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `return-ticket:${returnId}`);
      const ret = await tx.return.findUniqueOrThrow({ where: { id: returnId } });
      return this.ensureTicketInTransaction(tx, ret, existing);
    });
  }
  async forReturn(merchantId: string, returnId: string) {
    const ret = await this.prisma.return.findFirst({ where: { id: returnId, merchantId } });
    if (!ret) throw new NotFoundException("return_not_found");
    return this.ensureTicket(ret.id, true);
  }
  async operatorTicket(merchantId: string, ticketId: string): Promise<SupportTicket> {
    const row = await this.prisma.supportTicket.findFirst({ where: { merchantId, id: ticketId } });
    if (!row) throw new NotFoundException("ticket_not_found");
    if (row.mergedIntoId) return this.operatorTicket(merchantId, row.mergedIntoId);
    return { id: row.id, merchantId, buyerMessage: row.buyerMessage, status: row.status as SupportTicket["status"], source: row.source as SupportTicket["source"], sessionId: row.sessionId ?? undefined, returnId: row.returnId ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  private async ensureTicketInTransaction(tx: Prisma.TransactionClient, ret: { id: string; merchantId: string; buyerId: string; orderId: string; reason: string; notes: string | null; status: string; kind: string }, existing: boolean): Promise<ReturnRequestResult> {
    const previous = await tx.supportTicket.findFirst({ where: { merchantId: ret.merchantId, returnId: ret.id, mergedIntoId: null }, orderBy: { createdAt: "asc" } });
    if (previous) {
      if (!RESOLVED_RETURN_STATUSES.includes(ret.status) && ["closed", "resolved"].includes(previous.status)) {
        await tx.supportTicket.update({ where: { id: previous.id }, data: { status: "in_progress", resolvedAt: null } });
        await persistSupportMessage(tx, { merchantId: ret.merchantId, ticketId: previous.id, senderType: "system", content: "Sua solicitação ainda está em andamento. Esta conversa foi recuperada para acompanhar a resolução.", metadata: { kind: "case_update", event: "recovered" } });
      }
      return { returnId: ret.id, ticketId: previous.id, status: ret.status, existing };
    }
    const ticketId = `sup_${randomUUID()}`;
    const items = await tx.returnItem.findMany({ where: { returnId: ret.id } });
    const order = await this.orders.load(ret.merchantId, ret.orderId, ret.buyerId, tx, ret.id);
    const selected = items.map(it => ({ variantId: it.variantId, quantity: it.quantity, name: order.items.find(line => line.variantId === it.variantId)?.name ?? it.variantId }));
    const summary = `${ret.kind === "exchange" ? "Troca" : "Devolução"} — ${RETURN_REASON_LABELS[ret.reason]}\nPedido ${ret.orderId}\n${selected.map(it => `${it.quantity} × ${it.name}`).join("\n")}${ret.notes ? `\n\n${ret.notes}` : ""}`;
    const now = new Date();
    await tx.supportTicket.create({ data: { id: ticketId, merchantId: ret.merchantId, buyerId: ret.buyerId, returnId: ret.id,
      buyerMessage: summary, source: "return_request", status: "open", createdAt: now, updatedAt: now } });
    await persistSupportMessage(tx, { ticketId, merchantId: ret.merchantId, senderType: "buyer", content: summary,
      metadata: { kind: "return_request", returnId: ret.id, reason: ret.reason, reasonLabel: RETURN_REASON_LABELS[ret.reason]!, orderRef: ret.orderId, items: selected, imageUrls: [] } });
    await persistSupportMessage(tx, { ticketId, merchantId: ret.merchantId, senderType: "system", content: "Solicitação enviada à loja. Acompanhe e responda nesta conversa; avisaremos quando houver novidades.", metadata: { kind: "case_update", event: "created", returnId: ret.id } });
    await appendSupportEvent(tx, ret.merchantId, ticketId, "created");
    return { returnId: ret.id, ticketId, status: ret.status, existing };
  }

  async genericOpen(merchantId: string, buyerId: string, content: string, clientMessageId: string) {
    if (typeof content !== "string" || !content.trim() || content.length > 4000 || !/^[A-Za-z0-9_-]{8,100}$/.test(clientMessageId)) throw new BadRequestException("invalid_message");
    return this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `support-open:${merchantId}:${buyerId}`);
      const previous = await tx.supportTicket.findFirst({ where: { merchantId, buyerId, returnId: null, mergedIntoId: null, status: { in: ["open", "in_progress"] } }, orderBy: { createdAt: "desc" } });
      if (previous) {
        const sent = await tx.supportTicketMessage.findFirst({ where: { ticketId: previous.id, senderType: "buyer", clientMessageId } });
        if (!sent) await persistSupportMessage(tx, { merchantId, ticketId: previous.id, senderType: "buyer", content: content.trim(), clientMessageId });
        return { ticketId: previous.id };
      }
      const ticketId = `sup_${randomUUID()}`, now = new Date();
      await tx.supportTicket.create({ data: { id: ticketId, merchantId, buyerId, buyerMessage: content.trim(), status: "open", source: "widget", createdAt: now, updatedAt: now } });
      await persistSupportMessage(tx, { merchantId, ticketId, senderType: "buyer", content: content.trim(), clientMessageId });
      await appendSupportEvent(tx, merchantId, ticketId, "created");
      return { ticketId };
    });
  }

  async buyerTicket(buyerId: string, ticketId: string, merchantId?: string) {
    const candidate = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, buyerId, ...(merchantId ? { merchantId } : {}) } });
    if (!candidate) throw new NotFoundException("ticket_not_found");
    const ticket = candidate.mergedIntoId ? await this.prisma.supportTicket.findFirst({ where: { id: candidate.mergedIntoId, buyerId, merchantId: candidate.merchantId } }) : candidate;
    if (!ticket) throw new NotFoundException("ticket_not_found");
    return ticket;
  }

  async list(buyerId: string, merchantId?: string) {
    const tickets = await this.prisma.supportTicket.findMany({ where: { buyerId, mergedIntoId: null, ...(merchantId ? { merchantId } : {}) }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 100 });
    const items = await Promise.all(tickets.map(ticket => this.summary(ticket)));
    return { items, unreadCount: items.reduce((sum, it) => sum + it.unreadCount, 0) };
  }
  private async summary(ticket: any): Promise<SupportCaseSummary> {
    const ret = await this.linkedReturn(ticket);
    const aliases = await this.prisma.supportTicket.findMany({ where: { mergedIntoId: ticket.id, merchantId: ticket.merchantId }, select: { id: true } });
    const scope = { ticketId: { in: [ticket.id, ...aliases.map(a => a.id)] } };
    const [last, unread] = await Promise.all([
      this.prisma.supportTicketMessage.findFirst({ where: scope, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
      this.prisma.supportTicketMessage.count({ where: { ...scope, senderType: { in: ["merchant", "system"] }, ...(ticket.buyerReadAt ? { createdAt: { gt: ticket.buyerReadAt } } : {}) } }),
    ]);
    return { ticketId: ticket.id, merchantId: ticket.merchantId, returnId: ret?.id, orderId: ret?.orderId,
      kind: ret ? ret.kind as "refund" | "exchange" : "support", status: ticket.status, returnStatus: ret?.status,
      active: ret ? !RESOLVED_RETURN_STATUSES.includes(ret.status) : !["closed", "resolved"].includes(ticket.status),
      unreadCount: unread, lastMessage: last ? this.messageDto(last, ticket.id) : null, updatedAt: ticket.updatedAt.toISOString() };
  }
  private messageDto(message: any, ticketId: string): SupportCaseMessage {
    return { id: message.id, ticketId, senderType: message.senderType, content: message.content, metadata: message.metadata, createdAt: message.createdAt.toISOString() };
  }

  async detail(merchantId: string, ticketId: string, cursor?: string): Promise<SupportCaseDetail> {
    const candidate = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, merchantId } });
    if (!candidate) throw new NotFoundException("ticket_not_found");
    const ticket = candidate.mergedIntoId ? await this.prisma.supportTicket.findFirst({ where: { id: candidate.mergedIntoId, merchantId } }) : candidate;
    if (!ticket) throw new NotFoundException("ticket_not_found");
    const ret = await this.linkedReturn(ticket);
    let order: SupportOrder | null = null;
    if (ret) {
      try { order = await this.orders.load(merchantId, ret.orderId, ret.buyerId, this.prisma, ret.id); }
      catch { order = ret.orderSnapshot as unknown as SupportOrder | null; }
    }
    const aliases = await this.prisma.supportTicket.findMany({ where: { mergedIntoId: ticket.id, merchantId }, select: { id: true } });
    let after: { createdAt: Date; id: string } | undefined;
    if (cursor) {
      try { const value = JSON.parse(Buffer.from(cursor, "base64url").toString()); const date = new Date(value.createdAt); if (!Number.isFinite(date.getTime()) || typeof value.id !== "string") throw new Error(); after = { createdAt: date, id: value.id }; }
      catch { throw new BadRequestException("invalid_message_cursor"); }
    }
    const rows = await this.prisma.supportTicketMessage.findMany({ where: { ticketId: { in: [ticket.id, ...aliases.map(a => a.id)] }, ...(after ? { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 101 });
    const attachments = await this.prisma.supportAttachment.findMany({ where: { ticketId: { in: [ticket.id, ...aliases.map(a => a.id)] }, merchantId } });
    const legacyPhotos = (ret?.imageUrls ?? []).filter(url => /^https:\/\//.test(url));
    const imageUrls = [...this.photos.urls(attachments.map(a => a.id), merchantId), ...legacyPhotos];
    const urls = new Map(attachments.map((a, i) => [a.id, imageUrls[i]]));
    const messages = rows.slice(0,100).map(row => {
      const dto = this.messageDto(row, ticket.id);
      const meta = dto.metadata;
      if (meta?.kind === "return_request") dto.metadata = { ...meta, imageUrls: ret ? [...this.photos.urls((ret.imageUrls ?? []).filter(url => url.startsWith("attachment:")).map(url => url.slice(11)), merchantId), ...legacyPhotos] : [] };
      if (meta?.kind === "photos" && Array.isArray(meta.attachmentIds)) dto.metadata = { ...meta, imageUrls: (meta.attachmentIds as string[]).map(id => urls.get(id)).filter((value): value is string => Boolean(value)) };
      return dto;
    });
    const last = rows[99];
    return { ...await this.summary(ticket), order, reason: ret?.reason, reasonLabel: ret ? RETURN_REASON_LABELS[ret.reason] : undefined, notes: ret?.notes,
      selectedItems: ret?.items.map(it => ({ variantId: it.variantId, quantity: it.quantity, name: order?.items.find(line => line.variantId === it.variantId || line.sku === it.variantId)?.name ?? (it.variantId === "all" ? "Pedido completo (solicitação anterior)" : it.variantId) })) ?? [],
      imageUrls, messages, nextCursor: rows.length > 100 && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString("base64url") : null,
      refund: ret?.refund ? { status: ret.refund.status, amountInCents: ret.refund.amountInCents, providerRefundId: ret.refund.providerRefundId } : null, resolution: ret?.resolution as SupportCaseDetail["resolution"] };
  }

  async markRead(merchantId: string, ticketId: string, participant: "buyer" | "merchant", lastMessageId: string) {
    // Mark only messages actually displayed. A concurrent reply stays unread.
    const aliases = await this.prisma.supportTicket.findMany({ where: { mergedIntoId: ticketId, merchantId }, select: { id: true } });
    const last = await this.prisma.supportTicketMessage.findFirst({ where: { id: lastMessageId, ticketId: { in: [ticketId, ...aliases.map(a => a.id)] } } });
    if (!last) throw new BadRequestException("invalid_read_cursor");
    const field = participant === "buyer" ? "buyerReadAt" : "merchantReadAt";
    await this.prisma.supportTicket.updateMany({ where: { id: ticketId, merchantId, OR: [{ [field]: null }, { [field]: { lt: last.createdAt } }] }, data: { [field]: last.createdAt } });
    return { success: true };
  }
  async realtime(buyerId: string, ticketId: string, origin?: string, merchantId?: string) {
    const ticket = await this.buyerTicket(buyerId, ticketId, merchantId);
    return this.capabilities.issue({ purpose: "support-ticket", merchantId: ticket.merchantId, resourceId: ticket.id, origin });
  }
  async sendPhotos(merchantId: string, ticketId: string, buyerId: string, content: string, images: string[], clientMessageId: string) {
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientMessageId) || typeof content !== "string" || content.length > 4000) throw new BadRequestException("invalid_message");
    const ticket = await this.buyerTicket(buyerId, ticketId, merchantId);
    const previous = await this.prisma.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, senderType: "buyer", clientMessageId } });
    if (previous) return this.messageDto(previous, ticket.id);
    if (["closed", "resolved"].includes(ticket.status)) throw new ConflictException("ticket_resolved");
    const photos = await this.photos.prepare(images, merchantId, buyerId);
    if (!photos.length && !content.trim()) throw new BadRequestException("invalid_message");
    try { return await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `support:${ticket.id}`);
      const latest = await tx.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
      const old = await tx.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, senderType: "buyer", clientMessageId } });
      if (old) return this.messageDto(old, ticket.id);
      if (["closed", "resolved"].includes(latest.status)) throw new ConflictException("ticket_resolved");
      if (photos.length) await tx.supportAttachment.createMany({ data: photos.map(p => ({ ...p, ticketId: ticket.id })) });
      const message = await persistSupportMessage(tx, { merchantId, ticketId: ticket.id, senderType: "buyer", content: content.trim() || "Enviei fotos para a análise da loja.", clientMessageId,
        metadata: photos.length ? { kind: "photos", attachmentIds: photos.map(p => p.id), imageUrls: [] } : undefined });
      return this.messageDto(message, ticket.id);
    }); } finally { await this.photos.discardUnlinked(photos); }
  }

  async approveRefund(merchantId: string, ticketId: string, expectedAmountCents: number) {
    const detail = await this.detail(merchantId, ticketId);
    if (!detail.returnId || detail.kind !== "refund") throw new BadRequestException("refund_case_required");
    if (detail.refund) { await this.processRefund.execute(merchantId, detail.returnId); return this.detail(merchantId, ticketId); }
    if (!detail.active) throw new ConflictException("case_resolved");
    const preview = await this.orders.preview(merchantId, detail.returnId);
    if (!preview.automatic) throw new ConflictException("manual_refund_required");
    if (!Number.isSafeInteger(expectedAmountCents) || preview.amountCents !== expectedAmountCents) throw new ConflictException("refund_preview_changed");
    await this.processRefund.execute(merchantId, detail.returnId, expectedAmountCents);
    return this.detail(merchantId, ticketId);
  }

  async action(merchantId: string, ticketId: string, operatorId: string, input: { action: string; notes?: string; replacementOrderId?: string; trackingCode?: string; labelUrl?: string; itemCondition?: string; deliveryConfirmed?: boolean; items?: Array<{ variantId: string; quantity: number }> }) {
    if (typeof input.notes !== "string" || !input.notes.trim() || input.notes.length > 3500) throw new BadRequestException("resolution_notes_required");
    const notes = input.notes.trim();
    await this.prisma.$transaction(async tx => {
      await lockSupportResource(tx, `support:${ticketId}`);
      const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, merchantId, returnId: { not: null } } });
      if (!ticket?.returnId) throw new NotFoundException("return_not_found");
      const ret = await tx.return.findFirstOrThrow({ where: { id: ticket.returnId, merchantId }, include: { refund: true } });
      if (RESOLVED_RETURN_STATUSES.includes(ret.status) || ret.refund) throw new ConflictException("case_cannot_change_during_refund");
      let status: string; let event: string; let content: string;
      let resolution: Prisma.InputJsonObject = { ...(ret.resolution as Prisma.InputJsonObject ?? {}), instructions: notes };
      if (input.action === "confirm_items" && ["REQUESTED", "RECEIVED", "INSPECTED_PASS", "REFUND_PROCESSING"].includes(ret.status)) {
        const order = await this.orders.load(merchantId, ret.orderId, ret.buyerId, tx, ret.id);
        const selected = validateReturnItems(order, input.items ?? []);
        await tx.returnItem.deleteMany({ where: { returnId: ret.id } });
        await tx.returnItem.createMany({ data: selected.map(item => ({ returnId: ret.id, variantId: item.variantId, quantity: item.quantity })) });
        await tx.return.update({ where: { id: ret.id }, data: { orderSnapshot: order as unknown as Prisma.InputJsonValue } });
        status = ret.status; event = "items_confirmed"; content = "A loja confirmou os itens desta solicitação:\n" + selected.map(item => `${item.quantity} × ${item.name}`).join("\n") + "\n" + notes;
        resolution = { ...resolution, itemsConfirmedBy: operatorId, itemsConfirmedAt: new Date().toISOString() };
      } else if (input.action === "authorize_return" && ret.status === "REQUESTED") {
        status = "LABEL_GENERATED"; event = "return_authorized"; content = "A loja autorizou o envio dos itens selecionados.\n" + notes;
        if (input.labelUrl && (!/^https:\/\//.test(input.labelUrl) || input.labelUrl.includes("stub.zyon"))) throw new BadRequestException("real_shipping_label_required");
        if (input.labelUrl && input.trackingCode) await tx.returnLabel.create({ data: { returnId: ret.id, carrier: "Informado pela loja", trackingNumber: input.trackingCode, labelUrl: input.labelUrl, expiresAt: new Date(Date.now() + 30 * 86400000) } });
        resolution = { ...resolution, labelUrl: input.labelUrl ?? null, trackingCode: input.trackingCode ?? null };
      } else if (input.action === "received" && ["LABEL_GENERATED", "SHIPPED"].includes(ret.status)) {
        status = "RECEIVED"; event = "received"; content = "A loja recebeu os itens para análise.\n" + notes;
      } else if (input.action === "inspection_pass" && ret.status === "RECEIVED") {
        if (!["NEW", "GOOD", "DAMAGED"].includes(input.itemCondition ?? "")) throw new BadRequestException("item_condition_required");
        status = "INSPECTED_PASS"; event = "inspection_pass"; content = "A análise dos itens foi aprovada.\n" + notes;
        await tx.returnInspection.upsert({ where: { returnId: ret.id }, create: { returnId: ret.id, inspectedBy: operatorId, itemCondition: input.itemCondition as any, verdict: "PASS", notes }, update: {} });
      } else if (input.action === "reject" && ["REQUESTED", "RECEIVED", "INSPECTED_FAIL"].includes(ret.status)) {
        status = "REJECTED"; event = "rejected"; content = "A loja não aprovou a solicitação.\n" + notes;
      } else if (input.action === "complete_exchange" && ret.kind === "exchange" && ["REQUESTED", "INSPECTED_PASS"].includes(ret.status)) {
        if (!input.replacementOrderId?.trim() || !input.trackingCode?.trim() || input.deliveryConfirmed !== true) throw new BadRequestException("replacement_and_delivery_required");
        // Resolve only after the operator records the replacement and confirmed delivery.
        status = "EXCHANGE_COMPLETED"; event = "exchange_completed"; content = "Troca concluída.\nPedido de reposição: " + input.replacementOrderId.trim() + "\nEntrega: " + input.trackingCode.trim() + "\n" + notes;
        resolution = { ...resolution, replacementOrderId: input.replacementOrderId.trim(), trackingCode: input.trackingCode.trim(), completedBy: operatorId, completedAt: new Date().toISOString() };
      } else throw new ConflictException("invalid_case_transition");
      const terminal = RESOLVED_RETURN_STATUSES.includes(status);
      await tx.return.update({ where: { id: ret.id }, data: { status: status as any, resolution } });
      await persistSupportMessage(tx, { merchantId, ticketId, senderType: "system", content, metadata: { kind: "case_update", event, returnId: ret.id } });
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status: terminal ? "resolved" : "in_progress", assignedTo: operatorId, resolvedAt: terminal ? new Date() : null } });
    });
    return this.detail(merchantId, ticketId);
  }
}
