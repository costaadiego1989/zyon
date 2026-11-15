import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { beginHumanHandoff, type HandoffScope, type HandoffState, type HandoffTransition } from "../../domain/services/whatsapp-handoff-state.js";

/** Also held by session routing before expiry or checkout creation. */
export async function lockWhatsAppSessionIdentity(tx: Prisma.TransactionClient, identity: { merchantId: string; buyerPhone: string; deviceId: string }): Promise<void> {
  const key = JSON.stringify(["whatsapp-session", identity.merchantId, identity.buyerPhone, identity.deviceId]);
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`);
}

@Injectable()
export class PrismaWhatsAppHandoffRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getOrCreate(scope: HandoffScope): Promise<HandoffState> {
    return this.withLocked(scope, async (_tx, binding) => binding);
  }

  async get(scope: HandoffScope): Promise<HandoffState | null> {
    const row = await this.prisma.whatsAppHandoffBinding.findFirst({ where: scope });
    return row && row.merchantId === scope.merchantId ? this.snapshot(row) : null;
  }

  async withLocked<T>(scope: HandoffScope, work: (tx: Prisma.TransactionClient, binding: HandoffState) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => work(tx, await this.loadLocked(tx, scope)));
  }

  /** Caller retains this transaction through related ticket/message/outbox writes. */
  async loadLocked(tx: Prisma.TransactionClient, scope: HandoffScope): Promise<HandoffState> {
    const candidate = await tx.whatsAppSession.findFirst({ where: { id: scope.whatsappSessionId, merchantId: scope.merchantId } });
    if (!candidate || candidate.merchantId !== scope.merchantId) throw new NotFoundException("whatsapp_handoff_session_not_found");
    await lockWhatsAppSessionIdentity(tx, candidate);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM whatsapp_sessions WHERE id = ${scope.whatsappSessionId} AND merchant_id = ${scope.merchantId} FOR UPDATE`);
    const [session, config] = await Promise.all([
      tx.whatsAppSession.findFirst({ where: { id: scope.whatsappSessionId, merchantId: scope.merchantId } }),
      tx.whatsAppChannelConfig.findFirst({ where: { id: scope.configId, merchantId: scope.merchantId } }),
    ]);
    if (!session || !config || session.merchantId !== scope.merchantId || config.merchantId !== scope.merchantId
      || session.deviceId !== (config.deviceId ?? `${config.provider}:${config.id}`)) {
      throw new NotFoundException("whatsapp_handoff_scope_not_found");
    }
    const previous = await tx.whatsAppHandoffBinding.findFirst({ where: { merchantId: scope.merchantId, whatsappSessionId: scope.whatsappSessionId } });
    if (previous) {
      if (previous.configId !== scope.configId) throw new ConflictException("whatsapp_handoff_config_changed");
      return this.snapshot(previous);
    }
    const state = session.conversationState;
    const conversationId = state && typeof state === "object" && !Array.isArray(state) && typeof state.conversationId === "string"
      ? state.conversationId : session.checkoutSessionId;
    const row = await tx.whatsAppHandoffBinding.create({ data: { ...scope, conversationId } });
    return this.snapshot(row);
  }

  async begin(scope: HandoffScope, ticketId: string, expectedEpoch: number): Promise<HandoffTransition> {
    return this.withLocked(scope, (tx, current) => this.beginWithin(tx, scope, current, ticketId, expectedEpoch));
  }

  async beginWithin(tx: Prisma.TransactionClient, scope: HandoffScope, current: HandoffState, ticketId: string, expectedEpoch: number): Promise<HandoffTransition> {
    const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, merchantId: scope.merchantId,
      sessionId: scope.whatsappSessionId, source: "whatsapp", status: { in: ["open", "in_progress"] }, mergedIntoId: null } });
    if (!ticket || ticket.merchantId !== scope.merchantId) throw new NotFoundException("whatsapp_handoff_ticket_not_found");
    const transition = beginHumanHandoff(current, scope, ticketId, expectedEpoch);
    if (!transition.changed) return transition;
    const changed = await tx.whatsAppHandoffBinding.updateMany({ where: { ...scope, id: current.id, mode: current.mode, epoch: current.epoch },
      data: { mode: transition.state.mode, ticketId: transition.state.ticketId, epoch: transition.state.epoch, assignedOperatorId: null } });
    if (changed.count !== 1) throw new ConflictException("whatsapp_handoff_epoch_conflict");
    return transition;
  }

  private snapshot(row: HandoffState): HandoffState {
    return { id: row.id, merchantId: row.merchantId, configId: row.configId, whatsappSessionId: row.whatsappSessionId,
      mode: row.mode, epoch: row.epoch, ticketId: row.ticketId, assignedOperatorId: row.assignedOperatorId };
  }
}
