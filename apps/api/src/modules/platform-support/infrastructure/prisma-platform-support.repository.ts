import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient, type PlatformSupportTicket as TicketRow, type PlatformSupportMessage as MessageRow } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CreatePlatformSupportTicket, PlatformSupportConversation, PlatformSupportQuery, PlatformSupportTicket, SendPlatformSupportMessage } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { appendOutboxInTransaction } from "../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import { BILLING_PLANS, effectiveBillingPlan } from "../../payment/domain/billing-plans.js";
import { actorKey, SupportError, type PlatformSupportRepository, type SupportActor, type SupportTreatment } from "../domain/platform-support.js";

type Operator = Extract<SupportActor, { kind: "operator" }>;

@Injectable()
export class PrismaPlatformSupportRepository implements PlatformSupportRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async plan(merchantId: string) {
    // Follow the trusted account relation in a single scoped merchant lookup.
    // A top-level subscription query would be pinned to the child tenant by
    // Prisma's tenant middleware and hide the paying account's entitlement.
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: {
      billingSubscription: true, billingAccount: { select: { billingSubscription: true } },
    } });
    const subscription = merchant?.billingAccount?.billingSubscription ?? merchant?.billingSubscription;
    if (!subscription) return "starter" as const;
    return subscriptionPlan(subscription);
  }

  async create(actor: Extract<SupportActor, { kind: "merchant" }>, input: CreatePlatformSupportTicket) {
    const key = { merchantId: actor.merchantId, authorUserId: actor.id, clientRequestId: input.clientRequestId };
    let ticket = await this.prisma.platformSupportTicket.findUnique({ where: { merchantId_authorUserId_clientRequestId: key } });
    if (!ticket) {
      try {
        ticket = await this.prisma.$transaction(async tx => {
          const row = await tx.platformSupportTicket.create({ data: { ...key, subject: input.subject, category: input.category, waitingSince: new Date(), lastMessageSequence: 1 } });
          await tx.platformSupportMessage.create({ data: { ticketId: row.id, sequence: 1, authorKey: actorKey(actor), sender: "merchant", content: input.content, clientMessageId: input.clientRequestId } });
          await markRead(tx, row.id, actorKey(actor), 1);
          await changed(tx, row);
          return row;
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        ticket = await this.prisma.platformSupportTicket.findUniqueOrThrow({ where: { merchantId_authorUserId_clientRequestId: key } });
      }
    }
    const first = await this.prisma.platformSupportMessage.findUnique({ where: { ticketId_sequence: { ticketId: ticket.id, sequence: 1 } } });
    if (ticket.subject !== input.subject || ticket.category !== input.category || first?.content !== input.content) throw new SupportError("support_idempotency_conflict", 409);
    return this.conversation(actor, ticket.id);
  }

  async list(actor: SupportActor, query: PlatformSupportQuery, agingHours: number) {
    const priorityAccounts = await this.priorityAccounts(actor.kind === "merchant" ? actor.merchantId : undefined);
    const priority = priorityAccounts.length ? Prisma.sql`COALESCE(m.billing_account_merchant_id,m.id) IN (${Prisma.join(priorityAccounts)})` : Prisma.sql`FALSE`;
    const scope = actor.kind === "merchant" ? Prisma.sql`AND t.merchant_id = ${actor.merchantId}` : Prisma.empty;
    const state = query.status ? Prisma.sql`AND t.status = ${query.status}` : Prisma.empty;
    const search = query.search ? Prisma.sql`AND (t.subject ILIKE ${`%${query.search}%`} OR m.name ILIKE ${`%${query.search}%`} OR t.id = ${query.search})` : Prisma.empty;
    const mine = query.mine && actor.kind === "operator" ? Prisma.sql`AND t.assigned_operator_id = ${actor.id}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH ranked AS (
        SELECT t.id, ROW_NUMBER() OVER (ORDER BY
          CASE t.status WHEN 'waiting_customer' THEN 1 WHEN 'resolved' THEN 2 ELSE 0 END,
          CASE t.severity WHEN 'critical' THEN 2 WHEN 'high' THEN 1 ELSE 0 END DESC,
          CASE WHEN (${priority}) OR t.waiting_since <= NOW() - (${agingHours} * INTERVAL '1 hour') THEN 1 ELSE 0 END DESC,
          COALESCE(t.waiting_since,t.created_at), t.id) AS position
        FROM platform_support_tickets t JOIN merchants m ON m.id = t.merchant_id
        WHERE TRUE ${scope} ${state} ${search} ${mine}
      ) SELECT id FROM ranked
      WHERE position > COALESCE((SELECT position FROM ranked WHERE id = ${query.cursor ?? ""}),0)
      ORDER BY position LIMIT 51
    `);
    const ids = rows.slice(0, 50).map(row => row.id);
    const tickets = await this.prisma.platformSupportTicket.findMany({ where: { id: { in: ids } } });
    const presented = await this.present(actor, tickets, priorityAccounts);
    const byId = new Map(presented.map(ticket => [ticket.id, ticket]));
    return { items: ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []), nextCursor: rows.length > 50 ? ids.at(-1)! : null };
  }

  async conversation(actor: SupportActor, ticketId: string, before?: number): Promise<PlatformSupportConversation> {
    const row = await this.requireTicket(this.prisma, actor, ticketId);
    const [messages, peerRead] = await Promise.all([
      this.prisma.platformSupportMessage.findMany({ where: { ticketId, ...(before ? { sequence: { lt: before } } : {}) }, orderBy: { sequence: "desc" }, take: 101 }),
      this.prisma.platformSupportRead.aggregate({ where: { ticketId, actorKey: { startsWith: actor.kind === "merchant" ? "operator:" : "merchant:" } }, _max: { sequence: true } }),
    ]);
    return { ticket: (await this.present(actor, [row]))[0]!, messages: messages.slice(0, 100).reverse().map(presentMessage), hasMore: messages.length > 100, peerReadSequence: peerRead._max.sequence ?? 0 };
  }

  async send(actor: SupportActor, ticketId: string, input: SendPlatformSupportMessage) {
    return this.prisma.$transaction(async tx => {
      // Lock the ticket before checking deduplication; concurrent retries share one sequence.
      await tx.$queryRaw`SELECT id FROM platform_support_tickets WHERE id = ${ticketId} FOR UPDATE`;
      const ticket = await this.requireTicket(tx, actor, ticketId);
      const key = { ticketId, authorKey: actorKey(actor), clientMessageId: input.clientMessageId };
      const existing = await tx.platformSupportMessage.findUnique({ where: { ticketId_authorKey_clientMessageId: key } });
      if (existing) {
        if (existing.content !== input.content) throw new SupportError("support_idempotency_conflict", 409);
        return presentMessage(existing);
      }
      if (ticket.status === "resolved") throw new SupportError("support_ticket_resolved", 409);
      if (actor.kind === "operator" && ticket.assignedOperatorId && ticket.assignedOperatorId !== actor.id && !actor.canAssign) throw new SupportError("support_already_assigned", 409);
      const now = new Date();
      const row = await tx.platformSupportTicket.update({ where: { id: ticketId }, data: {
        lastMessageSequence: { increment: 1 },
        status: actor.kind === "operator" ? "waiting_customer" : ticket.assignedOperatorId ? "in_progress" : "open",
        waitingSince: actor.kind === "operator" ? null : ticket.waitingSince ?? now,
        ...(actor.kind === "operator" ? { firstResponseAt: ticket.firstResponseAt ?? now, assignedOperatorId: ticket.assignedOperatorId ?? actor.id } : {}),
      } });
      const message = await tx.platformSupportMessage.create({ data: { ...key, sequence: row.lastMessageSequence, sender: actor.kind, content: input.content } });
      await markRead(tx, ticketId, actorKey(actor), row.lastMessageSequence);
      if (actor.kind === "operator") await audit(tx, actor, "support.message.sent", ticketId);
      await changed(tx, row);
      return presentMessage(message);
    });
  }

  async read(actor: SupportActor, ticketId: string, sequence: number) {
    await this.prisma.$transaction(async tx => {
      const ticket = await this.requireTicket(tx, actor, ticketId);
      if (sequence > ticket.lastMessageSequence) throw new SupportError("support_invalid_sequence");
      const current = await tx.platformSupportRead.findUnique({ where: { ticketId_actorKey: { ticketId, actorKey: actorKey(actor) } } });
      if ((current?.sequence ?? 0) >= sequence) return;
      await markRead(tx, ticketId, actorKey(actor), sequence);
      await changed(tx, ticket);
    });
  }

  async treat(actor: Operator, ticketId: string, input: SupportTreatment) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM platform_support_tickets WHERE id = ${ticketId} FOR UPDATE`;
      const previous = await this.requireTicket(tx, actor, ticketId);
      if (input.assignedOperatorId !== undefined) {
        if (!actor.canAssign && input.assignedOperatorId === actor.id && previous.assignedOperatorId && previous.assignedOperatorId !== actor.id) throw new SupportError("support_already_assigned", 409);
        if (!actor.canAssign && input.assignedOperatorId !== actor.id && input.assignedOperatorId !== previous.assignedOperatorId) throw new SupportError("support_assignment_forbidden", 403);
        if (!actor.canAssign && input.assignedOperatorId === null && previous.assignedOperatorId !== actor.id) throw new SupportError("support_assignment_forbidden", 403);
        if (input.assignedOperatorId) {
          const operator = await tx.platformOperator.findUnique({ where: { id: input.assignedOperatorId } });
          if (!operator || operator.disabledAt || !["platform_admin", "support_ops"].includes(operator.role)) throw new SupportError("support_invalid_assignee");
        }
      }
      const row = await tx.platformSupportTicket.update({ where: { id: ticketId }, data: {
        ...input, ...(input.status === "resolved" ? { resolvedAt: new Date(), waitingSince: null } : {}),
        ...(input.status && input.status !== "resolved" && previous.status === "resolved" ? { resolvedAt: null, waitingSince: new Date() } : {}),
      } });
      await audit(tx, actor, "support.treatment.changed", ticketId, { previousStatus: previous.status, status: row.status, previousSeverity: previous.severity, severity: row.severity, previousAssignedOperatorId: previous.assignedOperatorId, assignedOperatorId: row.assignedOperatorId });
      await changed(tx, row);
    });
  }

  async reopen(actor: SupportActor, ticketId: string) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM platform_support_tickets WHERE id = ${ticketId} FOR UPDATE`;
      const previous = await this.requireTicket(tx, actor, ticketId);
      if (previous.status !== "resolved") return;
      const row = await tx.platformSupportTicket.update({ where: { id: ticketId }, data: { status: "open", assignedOperatorId: null, resolvedAt: null, waitingSince: new Date() } });
      if (actor.kind === "operator") await audit(tx, actor, "support.reopened", ticketId);
      await changed(tx, row);
    });
  }

  async notes(actor: Operator, ticketId: string) {
    await this.requireTicket(this.prisma, actor, ticketId);
    return (await this.prisma.platformSupportNote.findMany({ where: { ticketId }, orderBy: { createdAt: "desc" }, take: 100 })).map(row => ({ id: row.id, operatorId: row.operatorId, content: row.content, createdAt: row.createdAt.toISOString() }));
  }

  async addNote(actor: Operator, ticketId: string, content: string, clientRequestId: string) {
    await this.prisma.$transaction(async tx => {
      const ticket = await this.requireTicket(tx, actor, ticketId);
      const key = { ticketId, operatorId: actor.id, clientRequestId };
      const note = await tx.platformSupportNote.upsert({ where: { ticketId_operatorId_clientRequestId: key }, create: { ...key, content }, update: {} });
      if (note.content !== content) throw new SupportError("support_idempotency_conflict", 409);
      await audit(tx, actor, "support.note.added", ticketId);
      // Only an invalidation is published; note contents never enter public events.
      await changed(tx, ticket);
    });
  }

  async auditRead(actor: Operator, ticketId?: string) {
    await audit(this.prisma, actor, ticketId ? "support.ticket.read" : "support.queue.read", ticketId);
  }

  private async requireTicket(db: Pick<Prisma.TransactionClient, "platformSupportTicket">, actor: SupportActor, id: string) {
    const ticket = await db.platformSupportTicket.findFirst({ where: { id, ...(actor.kind === "merchant" ? { merchantId: actor.merchantId } : {}) } });
    if (!ticket) throw new SupportError("support_ticket_not_found", 404);
    return ticket;
  }

  private async priorityAccounts(merchantId?: string) {
    const scope = merchantId ? Prisma.sql`AND m.id = ${merchantId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ merchantId: string; status: string; stripePriceId: string | null; planKey: string | null }>>(Prisma.sql`
      SELECT DISTINCT b.merchant_id AS "merchantId", b.status, b.stripe_price_id AS "stripePriceId", b.plan_key AS "planKey"
      FROM merchant_billing_subscriptions b JOIN merchants m ON COALESCE(m.billing_account_merchant_id,m.id) = b.merchant_id
      JOIN platform_support_tickets t ON t.merchant_id = m.id WHERE b.status = 'active' ${scope}
    `);
    return rows.filter(row => BILLING_PLANS[subscriptionPlan(row)].features.prioritySupport).map(row => row.merchantId);
  }

  private async present(actor: SupportActor, tickets: TicketRow[], priorityAccounts?: string[]): Promise<PlatformSupportTicket[]> {
    const [merchants, reads, operators, priority] = await Promise.all([
      this.prisma.merchant.findMany({ where: { id: { in: tickets.map(row => row.merchantId) } }, select: { id: true, name: true, billingAccountMerchantId: true } }),
      this.prisma.platformSupportRead.findMany({ where: { ticketId: { in: tickets.map(row => row.id) }, actorKey: actorKey(actor) } }),
      this.prisma.platformOperator.findMany({ where: { id: { in: tickets.flatMap(row => row.assignedOperatorId ? [row.assignedOperatorId] : []) } }, select: { id: true, email: true } }),
      priorityAccounts ?? this.priorityAccounts(actor.kind === "merchant" ? actor.merchantId : undefined),
    ]);
    return tickets.map(row => {
      const merchant = merchants.find(m => m.id === row.merchantId);
      return { id: row.id, merchantId: row.merchantId, merchantName: merchant?.name ?? "Loja", subject: row.subject, category: row.category as PlatformSupportTicket["category"], status: row.status as PlatformSupportTicket["status"], severity: row.severity as PlatformSupportTicket["severity"], tier: priority.includes(merchant?.billingAccountMerchantId ?? row.merchantId) ? "priority" : "standard", assignedOperatorId: row.assignedOperatorId, assignedOperatorName: actor.kind === "operator" ? operators.find(o => o.id === row.assignedOperatorId)?.email ?? null : row.assignedOperatorId ? "Equipe Zyon" : null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), waitingSince: row.waitingSince?.toISOString() ?? null, firstResponseAt: row.firstResponseAt?.toISOString() ?? null, resolvedAt: row.resolvedAt?.toISOString() ?? null, lastMessageSequence: row.lastMessageSequence, unreadCount: Math.max(0, row.lastMessageSequence - (reads.find(read => read.ticketId === row.id)?.sequence ?? 0)) };
    });
  }
}

function subscriptionPlan(row: { status: string; stripePriceId: string | null; planKey: string | null; trialEndsAt?: Date | null }) {
  const planKey = row.planKey === "scale" || row.planKey === "growth" || row.planKey === "starter179" ? row.planKey : "starter";
  const status = row.status === "active" || row.status === "trialing" ? row.status : "starter";
  return effectiveBillingPlan({ status, stripePriceId: row.stripePriceId ?? undefined, planKey, trialEndsAt: row.trialEndsAt?.toISOString() });
}

function presentMessage(row: MessageRow) {
  return { id: row.id, ticketId: row.ticketId, sequence: row.sequence, sender: row.sender as "merchant" | "operator", senderName: row.sender === "operator" ? "Equipe Zyon" : "Lojista", content: row.content, clientMessageId: row.clientMessageId, createdAt: row.createdAt.toISOString() };
}

async function markRead(tx: Pick<Prisma.TransactionClient, "$executeRaw">, ticketId: string, key: string, sequence: number) {
  await tx.$executeRaw`INSERT INTO platform_support_reads (ticket_id,actor_key,sequence,updated_at) VALUES (${ticketId},${key},${sequence},NOW()) ON CONFLICT (ticket_id,actor_key) DO UPDATE SET sequence = GREATEST(platform_support_reads.sequence,EXCLUDED.sequence), updated_at = NOW()`;
}

async function changed(tx: Prisma.TransactionClient, ticket: TicketRow) {
  const eventId = randomUUID();
  await appendOutboxInTransaction(tx, { event_id: eventId, event_type: "platform.support.changed", schema_version: 1, merchant_id: ticket.merchantId, occurred_at: new Date().toISOString(), correlation_id: eventId, causation_id: ticket.id, producer: "platform-support", payload: { ticketId: ticket.id } });
}

async function audit(tx: Pick<Prisma.TransactionClient, "platformAuditEvent">, actor: Operator, action: string, targetId?: string, details?: Prisma.InputJsonObject) {
  await tx.platformAuditEvent.create({ data: { actorOperatorId: actor.id, action, permission: action.endsWith(".read") ? "platform:support:read" : "platform:support:write", environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "unknown", targetType: "platform_support_ticket", targetId, correlationId: randomUUID(), outcome: "succeeded", details: details ?? {} } });
}
