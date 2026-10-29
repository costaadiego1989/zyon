import { Global, Inject, Injectable, Module, type OnModuleInit, type OnApplicationShutdown } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../events/domain-event-bus.port.js";
import { PRISMA_CLIENT, PersistenceModule } from "../persistence/persistence.module.js";
import { ServiceSlotHoldsService } from "./service-slot-holds.service.js";
import { closeServiceSlotStore, slotFingerprint, type SlotRequest } from "./redis-service-slots.js";

@Injectable()
export class ServiceSlotHoldLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(DOMAIN_EVENT_BUS) private readonly bus: DomainEventBus,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly holds: ServiceSlotHoldsService) {}
  onModuleInit() {
    for (const type of ["order.completed", "payment.status.changed", "checkout.cart.updated"]) {
      this.bus.subscribe(type, event => this.handle(event), `bookings.holds.${type}.v1`);
    }
  }
  onApplicationShutdown() { closeServiceSlotStore(); }
  private async handle(event: DomainEvent) {
    const payload = event.payload as { session_id?: string; status?: string; payment_intent_id?: string; previous_service_slots?: SlotRequest[] };
    if (!payload.session_id) return;
    if (event.eventType === "checkout.cart.updated" && !payload.previous_service_slots?.length) return;
    const scope = { merchantId: event.merchantId, sessionId: payload.session_id };
    const session = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
    const items = (session?.cart as any)?.items;
    if (!Array.isArray(items) || !items.some((item: any) => item.fulfillmentStrategy === "scheduled_service")) {
      // Physical-only checkouts must remain independent of Redis scheduling.
      if (event.eventType !== "checkout.cart.updated") return;
    }
    if (event.eventType === "order.completed") {
      if (await this.prisma.completedOrder.findFirst({ where: scope })) await this.holds.release(scope.merchantId, scope.sessionId);
    } else if (event.eventType === "payment.status.changed" && ["failed", "cancelled", "refunded"].includes(payload.status ?? "")) {
      if (!payload.payment_intent_id || !await this.prisma.paymentIntent.findFirst({ where: { ...scope, id: payload.payment_intent_id, status: payload.status } })) return;
      if (!await this.prisma.paymentIntent.findFirst({ where: { ...scope, status: { notIn: ["failed", "cancelled", "refunded"] } } })) await this.holds.release(scope.merchantId, scope.sessionId);
    } else if (event.eventType === "checkout.cart.updated" && payload.previous_service_slots?.length) {
      const previous = slotFingerprint(payload.previous_service_slots);
      const current = (items ?? []).filter((item: any) => item.fulfillmentStrategy === "scheduled_service").map((item: any) => ({ resourceId: item.variantId, slotId: item.fulfillmentSchedule.slotId, startsAt: item.fulfillmentSchedule.startsAt, endsAt: item.fulfillmentSchedule.endsAt }));
      if (previous !== slotFingerprint(current)) await this.holds.release(scope.merchantId, scope.sessionId, previous);
    }
  }
}
@Global()
@Module({ imports: [PersistenceModule], providers: [ServiceSlotHoldsService, ServiceSlotHoldLifecycle], exports: [ServiceSlotHoldsService] })
export class ServiceSlotHoldsModule {}
