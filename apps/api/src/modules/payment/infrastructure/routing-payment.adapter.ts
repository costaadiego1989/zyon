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
import { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import { EvmCryptoPaymentAdapter } from "./evm-crypto-payment.adapter.js";
import type {
  PaymentPlatformRepository,
} from "../domain/ports/payment-platform-repository.port.js";

@Injectable()
export class RoutingPaymentAdapter implements PaymentProviderPort {
  constructor(
    private readonly stripe: StripePaymentAdapter | null,
    private readonly asaas: AsaasPaymentAdapter | null,
    private readonly mercadopago: MercadoPagoPaymentAdapter | null,
    private readonly evmCrypto: EvmCryptoPaymentAdapter,
    private readonly platformConnections?: PaymentPlatformRepository,
    private readonly asaasBaseUrl?: string,
    private readonly mercadopagoBaseUrl?: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  async preparePayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentInput> {
    const route = await this.creationRoute(input);
    return { ...input, provider: route.name, providerAccountFingerprint: route.adapter.creationAccountFingerprint?.() };
  }

  async recoverPayment(input: CreateProviderPaymentInput, firstAttemptAt: string): Promise<CreateProviderPaymentOutput | null> {
    const { adapter } = await this.creationRoute(input);
    this.assertAccount(adapter, input.providerAccountFingerprint);
    return adapter.recoverPayment ? adapter.recoverPayment(input, firstAttemptAt) : null;
  }

  private assertAccount(adapter: PaymentProviderPort, fingerprint?: string): void {
    if (fingerprint && adapter.creationAccountFingerprint?.() !== fingerprint) throw new Error("payment_provider_account_changed");
  }

  private async creationRoute(input: Pick<CreateProviderPaymentInput, "merchantId" | "method" | "provider">): Promise<{ name: NonNullable<CreateProviderPaymentInput["provider"]>; adapter: PaymentProviderPort }> {
    if (input.provider === "crypto" || (!input.provider && input.method === "crypto")) return { name: "crypto", adapter: this.evmCrypto };
    if (input.provider === "stripe" || (!input.provider && input.method === "card")) {
      if (!this.stripe) throw new Error("payment_provider_not_configured");
      return { name: "stripe", adapter: this.stripe };
    }
    if (!input.provider || input.provider === "mercadopago") {
      const mp = await this.resolveMercadoPago(input.merchantId);
      if (mp) return { name: "mercadopago", adapter: mp };
      if (input.provider) throw new Error("payment_provider_not_configured");
    }
    const asaas = await this.resolveAsaas(input.merchantId);
    if (!asaas) throw new Error("payment_provider_not_configured");
    return { name: "asaas", adapter: asaas };
  }

  async createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<CreateProviderPaymentOutput> {
    if (input.provider) {
      const { adapter } = await this.creationRoute(input);
      this.assertAccount(adapter, input.providerAccountFingerprint);
      return adapter.createPayment(input);
    }
    if (input.method === "crypto") {
      return this.evmCrypto.createPayment(input);
    }
    if (input.method === "card" && this.stripe) {
      return this.stripe.createPayment(input);
    }

    // Priority: mercadopago > asaas for PIX/boleto (if configured)
    const mercadopago = await this.resolveMercadoPago(input.merchantId);
    if (mercadopago && (input.method === "pix" || input.method === "boleto")) {
      return mercadopago.createPayment(input);
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
    if (input.provider) {
      const { adapter } = await this.creationRoute({ merchantId: input.merchantId, provider: input.provider, method: "" });
      this.assertAccount(adapter, input.providerAccountFingerprint);
      if (!adapter.fetchPaymentStatus) return { state: "unknown" };
      return adapter.fetchPaymentStatus(input);
    }
    const isStripeId = input.providerPaymentId.startsWith("pi_");
    if (isStripeId && this.stripe) {
      return this.stripe.fetchPaymentStatus(input);
    }

    const mercadopago = await this.resolveMercadoPago(input.merchantId);
    if (mercadopago) {
      // Try mercadopago first — if it fails, try asaas
      try {
        return await mercadopago.fetchPaymentStatus(input);
      } catch {
        // Fall through to asaas
      }
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

  private async resolveMercadoPago(
    merchantId: string,
  ): Promise<MercadoPagoPaymentAdapter | null> {
    const connection =
      await this.platformConnections?.getConnection(
        merchantId,
        "mercadopago",
      );
    if (this.platformConnections && connection?.status !== "active") {
      return null;
    }
    const tenantKey =
      await this.platformConnections?.getConnectionSecret(
        merchantId,
        "mercadopago",
      );
    if (tenantKey && this.mercadopagoBaseUrl) {
      return new MercadoPagoPaymentAdapter(
        this.mercadopagoBaseUrl,
        tenantKey,
        "",
        this.fetchImpl,
      );
    }
    return this.mercadopago;
  }
}
