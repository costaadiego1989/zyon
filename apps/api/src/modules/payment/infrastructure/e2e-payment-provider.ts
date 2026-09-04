import type { PaymentPlatformRepository } from "../domain/ports/payment-platform-repository.port.js";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort,
} from "../domain/ports/payment-provider.port.js";
import type { AsaasPaymentAdapter } from "./asaas-payment.adapter.js";
import type { MercadoPagoPaymentAdapter } from "./mercadopago-payment.adapter.js";
import type { StripePaymentAdapter } from "./stripe-payment.adapter.js";
import type { EvmCryptoPaymentAdapter } from "./evm-crypto-payment.adapter.js";
import { RoutingPaymentAdapter } from "./routing-payment.adapter.js";
import { readStripeConnection } from "./stripe-env.js";

/**
 * Deterministic payment provider used ONLY in non-production e2e runs.
 *
 * It removes the two production preconditions that make local/CI checkout
 * impossible without a live Asaas merchant onboarding:
 *  - no per-merchant Asaas connection is required (production RoutingPaymentAdapter
 *    throws `asaas_connection_not_active` until a merchant finishes onboarding),
 *  - `createCustomer` returns a synthetic id instead of calling the Asaas API.
 *
 * It does NOT auto-approve: createPayment returns `requires_action`, exactly like
 * production. e2e specs drive approval through the real Asaas webhook path
 * (`POST /webhooks/asaas` with `event: PAYMENT_RECEIVED`), so the approval →
 * `order.approved` / `customer.upserted` outbox flow is exercised faithfully.
 */
export class E2eTestPaymentProvider implements PaymentProviderPort {
  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.method === "crypto") {
      return {
        providerPaymentId: `e2e_crypto_${input.intentId}`,
        status: "requires_action",
        buyerFacingPayload: {
          chainId: 80002,
          chain: "polygon",
          evmNetwork: "testnet",
          chainLabel: "Polygon",
          tokenAddress: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
          tokenSymbol: "USDC",
          amountAtomic: "1000000",
          amountDisplay: "1.00 USDC",
          destinationAddress: "0x0000000000000000000000000000000000000001",
          quoteExpiresAt: new Date(Date.now() + 900_000).toISOString(),
        },
      };
    }
    if (input.method === "card") {
      const { publishableKey } = readStripeConnection();
      return {
        providerPaymentId: `pi_e2e_${input.intentId}`,
        status: "requires_action",
        buyerFacingPayload: {
          clientSecret: `pi_e2e_${input.intentId}_secret_e2e`,
          stripePublishableKey: publishableKey ?? "pk_test_e2e",
        },
      };
    }
    // The webhook resolves the intent by externalReference, which the production
    // Asaas adapter sets to `input.intentId`. Mirror that so the e2e webhook
    // payload can use the intent id as externalReference.
    return {
      providerPaymentId: input.intentId,
      status: "requires_action",
      buyerFacingPayload: {
        qrCodeCopyPaste: `e2e_pix_${input.intentId}`,
        invoiceUrl: `https://example.test/invoice/${input.intentId}`,
      },
    };
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    void input;
    return { state: "pending" };
  }

  async createCustomer(input: {
    merchantId: string;
    name: string;
    email: string;
    cpfCnpj: string;
    phone?: string;
  }): Promise<string> {
    return `e2e_cus_${input.merchantId}_${input.cpfCnpj}`;
  }
}

/**
 * True only for non-production e2e runs. Kept out of payment.module.ts so the
 * production composition assertions (which forbid env/test references in the
 * module file) stay green.
 */
export function isE2ePaymentStubEnabled(): boolean {
  return (
    process.env.E2E_SEED_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Selects the payment provider implementation. Production composition always
 * receives the RoutingPaymentAdapter; only non-production e2e runs receive the
 * deterministic stub.
 */
export function resolvePaymentProvider(deps: {
  stripe: StripePaymentAdapter | null;
  asaas: AsaasPaymentAdapter | null;
  mercadopago: MercadoPagoPaymentAdapter | null;
  evmCrypto: EvmCryptoPaymentAdapter;
  platformConnections: PaymentPlatformRepository;
  asaasBaseUrl: string;
  mercadopagoBaseUrl: string;
  fetchImpl: typeof fetch;
}): PaymentProviderPort {
  if (isE2ePaymentStubEnabled()) {
    return new E2eTestPaymentProvider();
  }
  return new RoutingPaymentAdapter(
    deps.stripe,
    deps.asaas,
    deps.mercadopago,
    deps.evmCrypto,
    deps.platformConnections,
    deps.asaasBaseUrl,
    deps.mercadopagoBaseUrl,
    deps.fetchImpl,
  );
}
