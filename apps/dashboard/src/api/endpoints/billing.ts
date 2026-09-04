import { dashboardJson } from "../http/client.js";
import type {
  PaymentConnection,
  PaymentOnboardingLinkResponse,
  BillingSubscription,
  BillingPlanCard,
  BillingCheckoutSessionResponse,
  BillingPortalSessionResponse,
} from "../types.js";

export function billingEndpoints(base: string, f: typeof fetch) {
  return {
    getBillingSubscription(): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription", { method: "GET" }, f);
    },
    // Asaas subscription lifecycle
    listBillingPlans(): Promise<BillingPlanCard[]> {
      return dashboardJson(base, "/billing/plans", { method: "GET" }, f);
    },
    startBillingTrial(): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription/start-trial", { method: "POST" }, f);
    },
    subscribeToPlan(payload: {
      planKey: "growth" | "scale";
      card: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };
      holderInfo: { name: string; email: string; cpfCnpj: string; postalCode: string; addressNumber: string; phone: string };
    }): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription", { method: "POST", jsonBody: payload }, f);
    },
    changeBillingPlan(payload: { targetPlan: "starter" | "growth" | "scale" }): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription/change", { method: "POST", jsonBody: payload }, f);
    },
    cancelBillingSubscription(payload?: { immediate?: boolean }): Promise<BillingSubscription> {
      return dashboardJson(base, "/billing/subscription/cancel", { method: "POST", jsonBody: payload ?? {} }, f);
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
    approveAsaasSandbox(): Promise<PaymentConnection> {
      return dashboardJson(base, "/payments/connections/asaas/sandbox-approve", { method: "POST" }, f);
    },
    createMercadoPagoOAuthLink(): Promise<{ url: string }> {
      return dashboardJson(base, "/merchants/me/payment-connections/mercadopago/oauth-link", { method: "POST" }, f);
    },
    syncMercadoPagoConnection(): Promise<PaymentConnection> {
      return dashboardJson(base, "/merchants/me/payment-connections/mercadopago/sync", { method: "POST" }, f);
    },
    disconnectPaymentConnection(provider: "stripe" | "asaas" | "mercadopago"): Promise<{ success: boolean }> {
      return dashboardJson(base, `/merchants/me/payment-connections/${encodeURIComponent(provider)}`, { method: "DELETE" }, f);
    },
    enableCryptoPayments(payload: { enabled: boolean; chain: "polygon" | "base"; network: "mainnet" | "testnet"; treasuryAddress: string; token: "USDC" }): Promise<{ success: boolean }> {
      return dashboardJson(base, "/merchants/me/crypto-payments/enable", { method: "POST", jsonBody: payload }, f);
    },
  };
}