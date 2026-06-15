import { Injectable } from "@nestjs/common";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";
import { StripePaymentAdapter } from "./stripe-payment.adapter.js";
import { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import { EvmCryptoPaymentAdapter } from "./evm-crypto-payment.adapter.js";
import type {
  PaymentPlatformRepository,
} from "../domain/ports/payment-platform-repository.port.js";

@Injectable()
export class RoutingPaymentAdapter implements PaymentProviderPort {
  constructor(
    private readonly stripe: StripePaymentAdapter | null,
    private readonly asaas: AsaasPaymentAdapter | null,
    private readonly evmCrypto: EvmCryptoPaymentAdapter,
    private readonly platformConnections?: PaymentPlatformRepository,
    private readonly asaasBaseUrl?: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<CreateProviderPaymentOutput> {
    if (input.method === "crypto") {
      return this.evmCrypto.createPayment(input);
    }
    if (input.method === "card" && this.stripe) {
      return this.stripe.createPayment(input);
    }
    const asaas = await this.resolveAsaas(input.merchantId);
    if (asaas) {
      return asaas.createPayment(input);
    }
    throw new Error("payment_provider_not_configured");
  }

  async fetchPaymentStatus(
    input: FetchPaymentStatusInput,
  ): Promise<FetchPaymentStatusOutput> {
    const isStripeId = input.providerPaymentId.startsWith("pi_");
    if (isStripeId && this.stripe) {
      return this.stripe.fetchPaymentStatus(input);
    }
    const asaas = await this.resolveAsaas(input.merchantId);
    if (asaas) {
      return asaas.fetchPaymentStatus(input);
    }
    throw new Error("payment_provider_not_configured");
  }

  async createCustomer(input: {
    merchantId: string;
    name: string;
    email: string;
    cpfCnpj: string;
    phone?: string;
  }): Promise<string> {
    const asaas = await this.resolveAsaas(input.merchantId);
    if (asaas) {
      return asaas.createCustomer(input);
    }
    throw new Error("payment_provider_not_configured_for_customer_creation");
  }

  private async resolveAsaas(
    merchantId: string,
  ): Promise<AsaasPaymentAdapter | null> {
    const connection =
      await this.platformConnections?.getConnection(
        merchantId,
        "asaas",
      );
    if (this.platformConnections && connection?.status !== "active") {
      throw new Error("asaas_connection_not_active");
    }
    const tenantKey =
      await this.platformConnections?.getConnectionSecret(
        merchantId,
        "asaas",
      );
    if (tenantKey && this.asaasBaseUrl) {
      return new AsaasPaymentAdapter(
        this.asaasBaseUrl,
        tenantKey,
        this.fetchImpl,
      );
    }
    return this.asaas;
  }
}
