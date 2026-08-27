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

  async createPayment(
    input: CreateProviderPaymentInput,
  ): Promise<CreateProviderPaymentOutput> {
    if (input.method === "crypto") {
      return this.evmCrypto.createPayment(input);
    }

    // For card, try Stripe only if merchant connection is active, otherwise fall through to Asaas
    if (input.method === "card") {
      const stripe = await this.resolveStripe(input.merchantId);
      if (stripe) {
        return stripe.createPayment(input);
      }
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
    const rawSecret =
      await this.platformConnections?.getConnectionSecret(
        merchantId,
        "asaas",
      );
    const tenantKey = extractAsaasApiKey(rawSecret);
    if (tenantKey && this.asaasBaseUrl) {
      // Use sandbox URL when the merchant connection is in test environment
      const isSandbox = connection?.environment === "test";
      const baseUrl = isSandbox
        ? (process.env.ASAAS_BASE_URL_SANDBOX?.trim() || "https://sandbox.asaas.com/api")
        : this.asaasBaseUrl;
      return new AsaasPaymentAdapter(
        baseUrl,
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

  private async resolveStripe(
    merchantId: string,
  ): Promise<StripePaymentAdapter | null> {
    const connection =
      await this.platformConnections?.getConnection(
        merchantId,
        "stripe",
      );
    if (this.platformConnections && connection?.status !== "active") {
      return null;
    }
    return this.stripe;
  }
}

/**
 * The Asaas connection secret is stored as JSON (`{"apiKey":"...","webhookToken":"..."}`)
 * by SaveAsaasConnectionConfigUseCase. Older records may hold the raw key string.
 * Extract the API key from either shape.
 */
function extractAsaasApiKey(rawSecret: string | undefined): string | undefined {
  if (!rawSecret) return undefined;
  const trimmed = rawSecret.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { apiKey?: string };
      return typeof parsed.apiKey === "string" && parsed.apiKey.trim()
        ? parsed.apiKey.trim()
        : undefined;
    } catch {
      return undefined;
    }
  }
  return trimmed || undefined;
}
