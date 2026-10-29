import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { WHATSAPP_SENDER_PORT, type WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";

@Injectable()
export class OrderTrackingNotificationListener implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(WHATSAPP_SENDER_PORT) private readonly sender: WhatsAppSenderPort,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe("whatsapp.message.requested", (event) => this.deliver(event), "notification:order.tracking.whatsapp");
  }

  private async deliver(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown> | null;
    // This consumer only authorizes transactional tracking. Recovery campaigns
    // need their own consent/template workflow and must not fall through here.
    if (!payload || payload.template !== "order_tracking") {
      throw new Error("whatsapp_tracking_template_unsupported");
    }
    for (const key of ["phone", "message", "session_id", "external_order_id", "tracking_code"]) {
      if (typeof payload[key] !== "string" || !payload[key].trim()) {
        throw new Error("whatsapp_tracking_payload_invalid");
      }
    }
    if (!event.merchantId) throw new Error("whatsapp_tracking_merchant_required");
    const result = await this.sender.send({ phone: payload.phone as string, message: payload.message as string });
    // Missing configuration is pending delivery, never a successful queue ack.
    // Provider failures also propagate to the existing retry/dead-letter policy.
    if (result?.status !== "accepted") throw new Error("whatsapp_tracking_delivery_not_accepted");
  }
}
