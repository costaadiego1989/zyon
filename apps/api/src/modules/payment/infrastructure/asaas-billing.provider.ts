import { Injectable, Logger } from "@nestjs/common";
import type {
  BillingProviderPort,
  BillingCustomerInput,
  CreateSubscriptionInput,
  SubscriptionResult
} from "../domain/ports/billing-provider.port.js";

/**
 * Asaas recurring-subscription billing provider — charges merchants for their
 * SaaS plan. Mirrors AsaasPaymentAdapter's auth (header `access_token`, base
 * normalized to strip trailing /v3) but targets the /v3/subscriptions API.
 *
 * Card fields are sent to Asaas over HTTPS and MUST never be logged.
 */
@Injectable()
export class AsaasBillingProvider implements BillingProviderPort {
  private readonly logger = new Logger(AsaasBillingProvider.name);
  private readonly base: string;

  constructor(
    apiBaseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch
  ) {
    this.base = apiBaseUrl.replace(/\/+$/, "").replace(/\/(?:api\/)?v3$/i, "");
  }

  private headers(): Record<string, string> {
    return {
      accept: "application/json",
      "content-type": "application/json",
      access_token: this.apiKey
    };
  }

  private nextDueDate(): string {
    // First charge tomorrow (Asaas requires nextDueDate >= today).
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  async createCustomer(input: BillingCustomerInput): Promise<{ customerId: string }> {
    const cpf = input.cpfCnpj?.replace(/\D/g, "");
    // Idempotency: reuse an existing customer with the same CPF.
    if (cpf) {
      const existing = await this.findCustomerByCpf(cpf);
      if (existing) return { customerId: existing };
    }
    const body: Record<string, unknown> = { name: input.name, email: input.email };
    if (cpf) body.cpfCnpj = cpf;

    const res = await this.fetchImpl(`${this.base}/v3/customers`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      if (cpf) {
        const recovered = await this.findCustomerByCpf(cpf);
        if (recovered) return { customerId: recovered };
      }
      throw new Error(`asaas_billing_customer_failed:${res.status}:${err}`);
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("asaas_billing_customer_failed:no_id");
    return { customerId: json.id };
  }

  private async findCustomerByCpf(cpf: string): Promise<string | undefined> {
    try {
      const res = await this.fetchImpl(
        `${this.base}/v3/customers?cpfCnpj=${encodeURIComponent(cpf)}`,
        { headers: this.headers(), signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) return undefined;
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      return json.data?.[0]?.id;
    } catch {
      return undefined;
    }
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult> {
    const body: Record<string, unknown> = {
      customer: input.customerId,
      billingType: "CREDIT_CARD",
      value: Number(input.valueBrl.toFixed(2)),
      cycle: "MONTHLY",
      nextDueDate: this.nextDueDate(),
      description: `Zyon plano ${input.planKey}`,
      externalReference: `billing_${input.planKey}`
    };
    if (input.creditCardToken) {
      body.creditCardToken = input.creditCardToken;
    } else if (input.creditCard && input.creditCardHolderInfo) {
      body.creditCard = {
        holderName: input.creditCard.holderName,
        number: input.creditCard.number.replace(/\s/g, ""),
        expiryMonth: input.creditCard.expiryMonth,
        expiryYear: input.creditCard.expiryYear,
        ccv: input.creditCard.ccv
      };
      body.creditCardHolderInfo = {
        name: input.creditCardHolderInfo.name,
        email: input.creditCardHolderInfo.email,
        cpfCnpj: input.creditCardHolderInfo.cpfCnpj.replace(/\D/g, ""),
        postalCode: input.creditCardHolderInfo.postalCode.replace(/\D/g, ""),
        addressNumber: input.creditCardHolderInfo.addressNumber,
        phone: input.creditCardHolderInfo.phone.replace(/\D/g, "")
      };
    } else {
      throw new Error("asaas_billing_subscription_failed:card_required");
    }
    if (input.remoteIp) body.remoteIp = input.remoteIp;

    const res = await this.fetchImpl(`${this.base}/v3/subscriptions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      // Do not include the request body (card data) in logs/errors.
      this.logger.error(`createSubscription failed status=${res.status}`);
      throw new Error(`asaas_billing_subscription_failed:${res.status}:${err}`);
    }
    const json = (await res.json()) as { id?: string; status?: string };
    if (!json.id) throw new Error("asaas_billing_subscription_failed:no_id");
    return { subscriptionId: json.id, status: json.status ?? "ACTIVE" };
  }

  async updateSubscription(input: { subscriptionId: string; valueBrl: number }): Promise<{ status: string }> {
    const res = await this.fetchImpl(
      `${this.base}/v3/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
      {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({ value: Number(input.valueBrl.toFixed(2)), updatePendingPayments: true }),
        signal: AbortSignal.timeout(15_000)
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`asaas_billing_update_failed:${res.status}:${err}`);
    }
    const json = (await res.json()) as { status?: string };
    return { status: json.status ?? "ACTIVE" };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.base}/v3/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`asaas_billing_cancel_failed:${res.status}:${err}`);
    }
  }

  async getSubscription(subscriptionId: string): Promise<{ status: string; nextDueDate?: string } | null> {
    const res = await this.fetchImpl(
      `${this.base}/v3/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) }
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`asaas_billing_get_failed:${res.status}:${err}`);
    }
    const json = (await res.json()) as { status?: string; nextDueDate?: string };
    return { status: json.status ?? "unknown", nextDueDate: json.nextDueDate };
  }
}
