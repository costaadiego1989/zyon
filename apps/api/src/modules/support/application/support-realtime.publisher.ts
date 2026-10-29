import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { Server } from "socket.io";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { realtimeRoom } from "../../../shared/auth/realtime-capability.js";
import { supportMessageDto } from "./support-persistence.js";

@Injectable()
export class SupportRealtimePublisher implements OnModuleInit {
  server?: Server;
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  onModuleInit() {
    this.bus.subscribe("support.case.changed", async event => {
      if (!this.server) throw new Error("support_gateway_not_ready");
      const payload = event.payload as { ticketId: string; messageId?: string; event: string };
      const ticket = await this.prisma.supportTicket.findFirst({ where: { id: payload.ticketId, merchantId: event.merchantId } });
      if (!ticket) return;
      const room = realtimeRoom("ticket", event.merchantId, ticket.id);
      if (payload.messageId) {
        const message = await this.prisma.supportTicketMessage.findFirst({ where: { id: payload.messageId, ticketId: ticket.id } });
        if (message) this.server.to(room).emit("new_message", supportMessageDto(message));
      }
      this.server.to(room).emit("case_updated", { ticketId: ticket.id, status: ticket.status });
      this.server.to(realtimeRoom("merchant", event.merchantId)).emit("case_updated", { ticketId: ticket.id });
      if (payload.event === "created") this.server.to(realtimeRoom("merchant", event.merchantId)).emit("new_ticket", ticket);
      if (["resolved", "closed"].includes(ticket.status)) this.server.to(room).emit("ticket_closed", { ticketId: ticket.id, status: ticket.status });
    }, "support.realtime.v1");
  }
}
