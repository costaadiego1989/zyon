import { Injectable, Inject, OnModuleInit, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { RedeemCouponUseCase } from "../../application/use-cases/redeem-coupon.use-case.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { BOUND_COUPON_REDEMPTION, type BoundCouponRedemption } from "../../domain/ports/bound-coupon-redemption.port.js";
import { parseCheckoutCouponOrderAuthority } from "../../../checkout/domain/services/checkout-coupon-binding.js";
import { normalCheckoutCouponDiscountOwnerSchema } from "../../domain/contracts/normal-checkout-coupon-owner.schema.js";

const redemptionReference = z.string().min(1).max(191).refine(value => value.trim().length > 0);
const requestedRedemptionPayload = z.strictObject({ session_id: redemptionReference, external_order_id: redemptionReference });
const boundRequestedPayload = z.strictObject({ source_event_id: redemptionReference });
const boundOrderPayload = z.record(z.string(), z.unknown());
function hasField(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && key in value;
}

@Injectable()
export class CouponsOnOrderCompletedHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly redeemCoupon: RedeemCouponUseCase,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: Pick<OutboxRepository, "appendOutbox">,
    @Optional() @Inject(BOUND_COUPON_REDEMPTION) private readonly boundRedemption?: BoundCouponRedemption,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "order.completed",
      (event) => this.handle(event),
      "coupons.CouponsOnOrderCompletedHandler"
    );
    this.eventBus.subscribe(
      "coupon.redemption.requested",
      event => this.handleRequestedRedemption(event),
      "coupons.CouponsOnOrderCompletedHandler.redemption-requested"
    );
  }

  private async handle(event: DomainEvent): Promise<void> {
    if (hasField(event.payload, "coupon_authority")||hasField(event.payload,"normal_coupon_owner")) return this.handleBoundRedemption(event);
    const payload = event.payload as Record<string, unknown>;
    const session_id = payload["session_id"] as string | undefined;
    const external_order_id = payload["external_order_id"] as string | undefined;
    if (!session_id || !external_order_id) return;
    const merchant_id = event.merchantId;
    const correlationId = event.correlationId;
    const causationId = event.eventId ?? event.causationId ?? "order.completed";

    try {
      await this.redeemCoupon.execute({
        session_id,
        merchant_id,
        order_id: external_order_id
      });
    } catch {
      // A coupon-specific failure must not block subsequent order consumers.
      // Confirm durable recovery before ACK; an uncertain append stays pending.
      try {
        const tenant = redemptionReference.parse(merchant_id);
        const refs = requestedRedemptionPayload.parse({ session_id, external_order_id });
        const childId = "evt_coupon_redemption_retry_" + createHash("sha256")
          .update(JSON.stringify([tenant, refs.session_id, refs.external_order_id])).digest("hex");
        await this.outbox.appendOutbox({
          ...createCouponEventEnvelope({ eventType: "coupon.redemption.requested", merchantId: tenant,
            payload: refs, causationId }),
          event_id: childId,
          correlation_id: correlationId ?? childId,
        });
      } catch {
        throw new Error("coupon_redemption_failed");
      }
    }
  }

  private async handleBoundRedemption(event: DomainEvent): Promise<void> {
    let merchantId: string, eventId: string;
    const correlationId = event.correlationId;
    const boundRedemption = this.boundRedemption;
    try {
      merchantId = redemptionReference.parse(event.merchantId);
      eventId = redemptionReference.parse(event.eventId);
      if(!boundRedemption)throw new Error();
      const payload = boundOrderPayload.parse(event.payload);
      if(hasField(payload,"normal_coupon_owner")){
        if(hasField(payload,"coupon_authority"))throw new Error();
        const owner=normalCheckoutCouponDiscountOwnerSchema.parse(payload.normal_coupon_owner);
        if(owner.merchantId!==merchantId||owner.checkoutSessionId!==payload.session_id
          ||!redemptionReference.safeParse(payload.external_order_id).success
          ||!redemptionReference.safeParse(payload.payment_intent_id).success)throw new Error();
      }else{
        if (!hasField(payload, "coupon_authority")) throw new Error();
        const authority = parseCheckoutCouponOrderAuthority(payload.coupon_authority);
        if (authority.merchantId !== merchantId || authority.checkoutSessionId !== payload.session_id
          || authority.orderId !== payload.external_order_id) throw new Error();
      }
    } catch { throw new Error("coupon_redemption_failed"); }

    try {
      // The command rereads the immutable persisted source and journal. The
      // dispatched payload is never accepted as an alternative grant.
      await boundRedemption.redeem({ merchantId, eventId });
    } catch {
      try {
        const childId = "evt_coupon_redemption_retry_" + createHash("sha256")
          .update(JSON.stringify([merchantId, "bound", eventId])).digest("hex");
        await this.outbox.appendOutbox({
          ...createCouponEventEnvelope({ eventType: "coupon.redemption.requested", merchantId,
            payload: { source_event_id: eventId }, causationId: eventId }),
          event_id: childId, correlation_id: correlationId ?? childId,
        });
      } catch { throw new Error("coupon_redemption_failed"); }
    }
  }

  private async handleRequestedRedemption(event: DomainEvent): Promise<void> {
    try {
      const merchant_id = redemptionReference.parse(event.merchantId);
      if (hasField(event.payload, "source_event_id")) {
        const { source_event_id } = boundRequestedPayload.parse(event.payload);
        if (!this.boundRedemption) throw new Error();
        await this.boundRedemption.redeem({ merchantId: merchant_id, eventId: source_event_id });
        return;
      }
      const { session_id, external_order_id } = requestedRedemptionPayload.parse(event.payload);
      await this.redeemCoupon.execute({ session_id, merchant_id, order_id: external_order_id });
    } catch {
      // The child uses the dispatcher's existing retries; never recurse/enqueue.
      // The fixed error deliberately excludes the original cause and payload.
      throw new Error("coupon_redemption_failed");
    }
  }
}
