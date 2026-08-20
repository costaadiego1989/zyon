import { dashboardJson } from "../http/client.js";
import type {
  PaymentConnection,
  PaymentOnboardingLinkResponse,
  BillingSubscription,
  BillingCheckoutSessionResponse,
  BillingPortalSessionResponse,
} from "../types.js";

export function billingEndpoints(base: string, f: typeof fetch) {
  return {
    getBillingSubscription(): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription", { method: "GET" }, f);
    },
    createBillingCheckoutSession(payload: { price_id?: string; success_url?: string; cancel_url?: string }): Promise<BillingCheckoutSessionResponse> {
      return dashboardJson(base, "/billing/checkout-session", { method: "POST", jsonBody: payload }, f);
    },
    createBillingPortalSession(payload: { return_url?: string }): Promise<BillingPortalSessionResponse> {
      return dashboardJson(base, "/billing/portal-session", { method: "POST", jsonBody: payload }, f);
    },

    // Payment connections (billing-adjacent)
    async getPaymentConnections(): Promise<PaymentConnection[]> {
      const res = await dashboardJson<{ data: PaymentConnection[] } | PaymentConnection[]>(base, "/payments/connections", { method: "GET" }, f);
      return Array.isArray(res) ? res : (res?.data ?? []);
    },
    createStripeOnboardingLink(payload: { return_url?: string; refresh_url?: string }): Promise<PaymentOnboardingLinkResponse> {
      return dashboardJson(base, "/payments/connections/stripe/onboarding-link", { method: "POST", jsonBody: payload }, f);
    },
    syncStripeConnection(): Promise<PaymentConnection> {
      return dashboardJson(base, "/payments/connections/stripe/sync", { method: "POST" }, f);
    },
    connectAsaas(payload: { api_key: string; webhook_token?: string; sandbox?: boolean }): Promise<PaymentConnection> {
      return dashboardJson(base, "/merchants/me/payment-connections/asaas", { method: "POST", jsonBody: payload }, f);
    },
    createAsaasSubaccount(payload: Record<string, unknown>): Promise<PaymentConnection> {
      return dashboardJson(base, "/payments/connections/asaas", { method: "POST", jsonBody: payload }, f);
    },
    createAsaasOnboardingLink(payload: { return_url?: string }): Promise<PaymentOnboardingLinkResponse> {
      return dashboardJson(base, "/payments/connections/asaas/onboarding-link", { method: "POST", jsonBody: payload }, f);
    },
    syncAsaasConnection(): Promise<PaymentConnection> {
      return dashboardJson(base, "/payments/connections/asaas/sync", { method: "POST" }, f);
    },
    createMercadoPagoOAuthLink(): Promise<{ url: string }> {
      return dashboardJson(base, "/merchants/me/payment-connections/mercadopago/oauth-link", { method: "POST" }, f);
    },
    syncMercadoPagoConnection(): Promise<PaymentConnection> {
      return dashboardJson(base, "/merchants/me/payment-connections/mercadopago/sync", { method: "POST" }, f);
    },
    enableCryptoPayments(payload: { enabled: boolean; chain: "polygon" | "base"; network: "mainnet" | "testnet"; treasuryAddress: string; token: "USDC" }): Promise<{ success: boolean }> {
      return dashboardJson(base, "/merchants/me/crypto-payments/enable", { method: "POST", jsonBody: payload }, f);
    },
  };
}