import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { HandleAsaasBillingWebhookUseCase } from "../../application/payment-platform/billing/handle-asaas-billing-webhook.use-case.js";

/**
 * Asaas billing webhook — subscription lifecycle for the merchant's SaaS plan
 * (distinct from webhooks/asaas which handles buyer payments). Asaas payment
 * events carry `payment.subscription` (the subscription id) when the charge
 * belongs to a subscription. Token-authenticated via ASAAS_WEBHOOK_TOKEN.
 */
@Controller()
export class AsaasBillingWebhookController {
  constructor(private readonly handleBilling: HandleAsaasBillingWebhookUseCase) {}

  @Post("webhooks/asaas/billing")
  async billingWebhook(
    @Headers("asaas-access-token") token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
    // FAIL-CLOSED: reject when a token is configured and does not match. When no
    // token is configured we still accept (dev/sandbox), matching how the buyer
    // webhook degrades — but the resolver only mutates a merchant it can find by
    // subscription id, so a spoofed event with an unknown id is a no-op.
    if (expected && token?.trim() !== expected) {
      throw new UnauthorizedException("asaas_billing_webhook_token_invalid");
    }

    const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const event = typeof o.event === "string" ? o.event.trim() : "";
    const payment = (o.payment && typeof o.payment === "object" ? o.payment : {}) as Record<string, unknown>;
    // subscription id may arrive as `payment.subscription` (payment events) or
    // top-level `subscription` (subscription events).
    const subscriptionId =
      (typeof payment.subscription === "string" ? payment.subscription : undefined) ??
      (typeof o.subscription === "string" ? o.subscription : undefined);

    return this.handleBilling.execute({ event, subscriptionId });
  }
}
