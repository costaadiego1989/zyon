import { Injectable, Inject , Logger} from "@nestjs/common";
import type { CustomerHints, CheckoutSession } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { TenantWebhookPublisher } from "../../integrations/application/integrations.use-cases.js";
import { WebhookDeliveryDispatcher } from "../../integrations/application/webhook-delivery-dispatcher.service.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { Optional } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";

@Injectable()
export class UpdateEmbedCustomerUseCase {
  private readonly logger = new Logger(UpdateEmbedCustomerUseCase.name);

  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly webhookPublisher: TenantWebhookPublisher,
    private readonly webhookDispatcher: WebhookDeliveryDispatcher,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
  ) {}

  async execute(input: {
    merchantId: string;
    sessionId: string;
    customer: {
      fullName: string;
      email: string;
      cpf: string;
      phone?: string;
    };
  }): Promise<{ ok: true }> {
    const current = await this.sessions.getSession(input.merchantId, input.sessionId);
    if (!current) throw new Error("checkout_session_not_found");

    const previousCustomer = current.customer ?? {};
    const email = input.customer.email.trim().toLowerCase();
    const emailChanged = email !== previousCustomer.email?.trim().toLowerCase();
    const phoneChanged = input.customer.phone !== previousCustomer.phone;
    const updatedSession: CheckoutSession = {
      ...current,
      globalUserId: emailChanged ? `usr_${crypto.randomUUID()}` : current.globalUserId,
      customer: {
        ...(current.customer ?? {}),
        fullName: input.customer.fullName,
        email,
        cpf: input.customer.cpf.replace(/\D+/g, ""),
        phone: input.customer.phone,
        ...(emailChanged ? {
          email_verified: false, otp_code: "", recognized_buyer: false, isReturning: false,
          externalCustomerId: undefined, asaasCustomerId: undefined,
          address: undefined, address_verified: false,
        } : {}),
        ...(phoneChanged || emailChanged ? { phone_verified: false, phone_otp_code: "" } : {}),
      },
      shipping: emailChanged ? undefined : current.shipping,
      shippingOptions: emailChanged ? undefined : current.shippingOptions,
      updatedAt: new Date().toISOString()
    };

    await this.sessions.saveSession(updatedSession);

    if (updatedSession.globalUserId) {
      await this.emitFunnelEvents(
        input.merchantId,
        input.sessionId,
        previousCustomer,
        updatedSession.customer!,
        updatedSession.globalUserId
      );
    }

    return { ok: true };
  }

  private async emitFunnelEvents(
    merchantId: string,
    sessionId: string,
    previous: Partial<CustomerHints>,
    current: Partial<CustomerHints>,
    globalUserId: string
  ): Promise<void> {
    const now = new Date().toISOString();

    const phoneIsNew = !previous.phone && !!current.phone;
    if (phoneIsNew) {
      const deliveries = await this.webhookPublisher.publish({
        merchantId,
        eventType: "customer.phone_collected",
        occurredAt: now,
        data: {
          session_id: sessionId,
          global_user_id: globalUserId,
          phone_masked: this.maskPhone(current.phone!)
        }
      });
      await this.dispatchDeliveries(deliveries);
    }

    const fields: Array<{ key: keyof CustomerHints; label: string }> = [
      { key: "phone", label: "phone" },
      { key: "email", label: "email" },
      { key: "fullName", label: "name" },
      { key: "cpf", label: "cpf" }
    ];
    for (const field of fields) {
      const prev = previous[field.key];
      const curr = current[field.key];
      if (!prev && curr) {
        const deliveries = await this.webhookPublisher.publish({
          merchantId,
          eventType: "funnel.step_completed",
          occurredAt: now,
          data: {
            session_id: sessionId,
            global_user_id: globalUserId,
            field: field.label,
            value_masked: this.maskValue(field.label, String(curr))
          }
        });
        await this.dispatchDeliveries(deliveries);
      }
    }

    const allFilled = !!current.phone && !!current.email && !!current.fullName && !!current.cpf;
    const wasMissing = !previous.phone || !previous.email || !previous.fullName || !previous.cpf;
    if (allFilled && wasMissing) {
      const deliveries = await this.webhookPublisher.publish({
        merchantId,
        eventType: "customer.registered",
        occurredAt: now,
        data: {
          session_id: sessionId,
          global_user_id: globalUserId,
          data_controller: "merchant",
          customer: {
            phone: current.phone,
            email: current.email,
            full_name: current.fullName,
            cpf: this.maskCpf(String(current.cpf)),
            address: current.address ?? null
          }
        }
      });
      await this.dispatchDeliveries(deliveries);

      // Also emit on the domain bus (unmasked email/phone/name) so subscribers
      // like the CRM lead-sync can create the lead. Best-effort; never blocks.
      if (current.email) {
        try {
          await this.eventBus?.publish({
            eventType: "customer.registered",
            merchantId,
            payload: {
              session_id: sessionId,
              global_user_id: globalUserId,
              email: current.email,
              full_name: current.fullName ?? null,
              phone: current.phone ?? null,
            },
          });
        } catch { /* domain event is best-effort */ }
      }
    }
  }

  private async dispatchDeliveries(
    deliveries: Awaited<ReturnType<TenantWebhookPublisher["publish"]>>
  ): Promise<void> {
    for (const delivery of deliveries) {
      try {
        await this.webhookDispatcher.dispatchDelivery(delivery);
      } catch {
        // delivery remains queued for background retry
      }
    }
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return "****";
    return phone.slice(0, 2) + "*".repeat(phone.length - 4) + phone.slice(-2);
  }

  private maskCpf(cpf: string): string {
    const digits = cpf.replace(/\D/g, "");
    if (digits.length < 11) return "***.***.***-**";
    return `${digits.slice(0, 3)}.***.***.${digits.slice(-2)}`;
  }

  private maskValue(field: string, value: string): string {
    if (field === "phone") return this.maskPhone(value);
    if (field === "cpf") return this.maskCpf(value);
    if (field === "email") {
      const [local, domain] = value.split("@");
      if (!local || !domain) return "***@***";
      return local.slice(0, 2) + "***@" + domain;
    }
    if (value.length <= 3) return "***";
    return value.slice(0, 3) + "***";
  }
}
