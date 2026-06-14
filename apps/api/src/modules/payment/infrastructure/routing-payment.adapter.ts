import { Injectable } from "@nestjs/common";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";
import { isProduction } from "../../../shared/config/secret-config.js";
import { StripePaymentAdapter } from "./stripe-payment.adapter.js";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import { FakePaymentProvider } from "./fake-payment-provider.js";
import { EvmCryptoPaymentAdapter } from "./evm-crypto-payment.adapter.js";

@Injectable()
export class RoutingPaymentAdapter implements PaymentProviderPort {
  constructor(
    private readonly stripe: StripePaymentAdapter | null,
    private readonly asaas: AsaasPaymentAdapter | null,
    private readonly evmCrypto: EvmCryptoPaymentAdapter,
    private readonly fake: FakePaymentProvider
  ) {}

  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.method === "crypto") {
      return this.evmCrypto.createPayment(input);
    }
    if (input.method === "card" && this.stripe) {
      return this.stripe.createPayment(input);
    }
    if (this.asaas) {
      return this.asaas.createPayment(input);
    }
    return this.fake.createPayment(input);
  }

  fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    const isStripeId = input.providerPaymentId.startsWith("pi_");
    if (isStripeId && this.stripe) {
      return this.stripe.fetchPaymentStatus(input);
    }
    if (this.asaas) {
      return this.asaas.fetchPaymentStatus(input);
    }
    return this.fake.fetchPaymentStatus(input);
  }

  async createCustomer(input: { name: string; email: string; cpfCnpj: string; phone?: string }): Promise<string> {
    if (this.asaas) {
      return this.asaas.createCustomer(input);
    }
    if (isProduction()) {
      throw new Error("payment_provider_not_configured_for_customer_creation");
    }
    return `cust_fake_${Date.now()}`;
  }
}
