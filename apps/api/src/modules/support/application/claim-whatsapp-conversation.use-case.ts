import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { claimHumanHandoff, HandoffStateError, type HandoffTransition } from "../../whatsapp-channel/domain/services/whatsapp-handoff-state.js";
import { PrismaWhatsAppHandoffRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { appendSupportEvent, lockSupportResource, persistSupportMessage } from "./support-persistence.js";

@Injectable()
export class ClaimWhatsAppConversationUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly handoffs: PrismaWhatsAppHandoffRepository) {}

  async execute(principal: TenantPrincipal, ticketId: string, input: unknown) {
    if (principal.kind !== "human" || !["owner", "admin", "staff"].includes(principal.role))
      throw new ForbiddenException("human_session_required");
    if (typeof ticketId !== "string" || !ticketId.trim() || ticketId.length > 191
      || !input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => key !== "expectedEpoch")) throw new BadRequestException("invalid_whatsapp_claim");
    const expectedEpoch: unknown = Reflect.get(input, "expectedEpoch");
    if (typeof expectedEpoch !== "number" || !Number.isSafeInteger(expectedEpoch)
      || expectedEpoch < 0 || expectedEpoch > 2_147_483_647) throw new BadRequestException("invalid_whatsapp_claim");
    const merchantId = principal.tenantId;
    const candidate = await this.prisma.whatsAppHandoffBinding.findFirst({ where: { merchantId, ticketId } });
    if (!candidate) throw new NotFoundException("whatsapp_handoff_ticket_not_found");
    const scope = { merchantId, configId: candidate.configId, whatsappSessionId: candidate.whatsappSessionId };
    return this.handoffs.withReadLock(scope, async (tx, locked) => {
      const current = locked.binding;
      if (!current || current.ticketId !== ticketId) throw new NotFoundException("whatsapp_handoff_ticket_not_found");
      await lockSupportResource(tx, `support:${ticketId}`);
      const ticket = await tx.supportTicket.findFirst({ where: { id: ticketId, merchantId,
        sessionId: scope.whatsappSessionId, source: "whatsapp", mergedIntoId: null } });
      if (!ticket) throw new NotFoundException("whatsapp_handoff_ticket_not_found");
      if (!["open", "in_progress"].includes(ticket.status)
        || ticket.assignedTo !== null && ticket.assignedTo !== principal.userId)
        throw new ConflictException("whatsapp_conversation_unavailable");
      let transition: HandoffTransition;
      try { transition = claimHumanHandoff(current, scope, ticketId, expectedEpoch, principal.userId); }
      catch (error) { if (error instanceof HandoffStateError) throw new ConflictException(error.code); throw error; }
      if (!transition.changed) {
        if (ticket.status !== "in_progress" || ticket.assignedTo !== principal.userId)
          throw new ConflictException("whatsapp_conversation_inconsistent");
      } else {
        const changed = await tx.whatsAppHandoffBinding.updateMany({ where: { id: current.id, ...scope,
          ticketId, epoch: current.epoch, mode: "waiting_human", assignedOperatorId: null },
          data: { mode: "human", epoch: transition.state.epoch, assignedOperatorId: principal.userId } });
        if (changed.count !== 1) throw new ConflictException("whatsapp_handoff_epoch_conflict");
        const ticketChanged = await tx.supportTicket.updateMany({ where: { id: ticket.id, merchantId,
          status: ticket.status, assignedTo: ticket.assignedTo, source: "whatsapp", sessionId: scope.whatsappSessionId, mergedIntoId: null },
          data: { status: "in_progress", assignedTo: principal.userId, resolvedAt: null } });
        if (ticketChanged.count !== 1) throw new ConflictException("whatsapp_conversation_unavailable");
        const message = await persistSupportMessage(tx, { ticketId, merchantId, senderType: "system",
          content: "Atendimento assumido pela loja.", metadata: { kind: "whatsapp_claim", schemaVersion: 1,
            bindingId: current.id, configId: scope.configId, whatsappSessionId: scope.whatsappSessionId,
            previousEpoch: current.epoch, epoch: transition.state.epoch, operatorId: principal.userId } });
        await appendSupportEvent(tx, merchantId, ticketId, "claimed", message.id);
      }
      return { bindingId: current.id, ...scope, ticketId, mode: "human" as const,
        epoch: transition.state.epoch, assignedOperatorId: principal.userId, status: "in_progress" as const,
        idempotent: !transition.changed };
    });
  }
}
