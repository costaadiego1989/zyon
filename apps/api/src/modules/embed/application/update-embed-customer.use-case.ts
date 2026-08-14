import { Injectable, Inject } from "@nestjs/common";
import type { CustomerHints, CheckoutSession } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import { TenantWebhookPublisher } from "../../integrations/application/integrations.use-cases.js";
import { WebhookDeliveryDispatcher } from "../../integrations/application/webhook-delivery-dispatcher.service.js";

@Injectable()
export class UpdateEmbedCustomerUseCase {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepository,
    private readonly webhookPublisher: TenantWebhookPublisher,
    private readonly webhookDispatcher: WebhookDeliveryDispatcher
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
    const updatedSession: CheckoutSession = {
      ...current,
      customer: {
        ...(current.customer ?? {}),
        fullName: input.customer.fullName,
        email: input.customer.email,
        cpf: input.customer.cpf.replace(/\D+/g, ""),
        phone: input.customer.phone
      },
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
