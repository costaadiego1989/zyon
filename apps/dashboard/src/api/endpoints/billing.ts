import type { BillingCycle, BillingOffer } from "@zyon/shared-types";
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
  async function billingJson<T>(path: string, init: Parameters<typeof dashboardJson>[2] = {}): Promise<T> {
    const response = await dashboardJson<T | { data: T; meta: unknown }>(base, path, init, f);
    return response && typeof response === "object" && "meta" in response && "data" in response ? response.data : response as T;
  }
  return {
    getBillingSubscription(): Promise<BillingSubscription> {
      return billingJson("/billing/subscription");
    },
    // Billing catalog and subscription lifecycle
    async listBillingPlans(): Promise<BillingPlanCard[]> {
      const plans = await billingJson<Array<BillingPlanCard | { plan_id: string; name: string; monthly_price_brl: number; billing_options?: BillingOffer[]; annual_checkout_available?: boolean; transaction_fee_cents: number; features: Record<string, boolean>; limits: Record<string, number | null> }>>("/billing/plans");
      return plans.map(plan => "key" in plan ? plan : ({
        key: plan.plan_id, name: plan.name, priceBrl: plan.monthly_price_brl,
        transactionFeeCents: plan.transaction_fee_cents, limits: plan.limits,
        billingOptions: plan.billing_options, annualCheckoutAvailable: plan.annual_checkout_available,
        trialDays: plan.plan_id === "starter" ? 14 : 0,
        recommended: plan.plan_id === "growth", ctaLabel: plan.plan_id === "starter" ? "Continuar no Free" : `Escolher ${plan.name}`,
        features: Object.entries(plan.features).filter(([, enabled]) => enabled).map(([key]) => key),
      }));
    },
    startBillingTrial(): Promise<BillingSubscription> {
      return billingJson("/billing/subscription/start-trial", { method: "POST" });
    },
    subscribeToPlan(payload: {
      planKey: "growth" | "scale"; billingCycle?: BillingCycle;
      card: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };
      holderInfo: { name: string; email: string; cpfCnpj: string; postalCode: string; addressNumber: string; phone: string };
    }): Promise<BillingSubscription> {
      return billingJson("/billing/subscription", { method: "POST", jsonBody: payload });
    },
    changeBillingPlan(payload: { targetPlan: "starter" | "growth" | "scale"; billingCycle?: BillingCycle }): Promise<BillingSubscription> {
      return billingJson("/billing/subscription/change", { method: "POST", jsonBody: payload });
    },
    cancelBillingSubscription(payload?: { immediate?: boolean }): Promise<BillingSubscription> {
      return billingJson("/billing/subscription/cancel", { method: "POST", jsonBody: payload ?? {} });
    },
    createBillingCheckoutSession(payload: { plan?: "growth" | "scale"; billingCycle?: BillingCycle; price_id?: string; success_url?: string; cancel_url?: string }): Promise<BillingCheckoutSessionResponse> {
      return billingJson("/billing/checkout-session", { method: "POST", jsonBody: payload });
    },
    createBillingPortalSession(payload: { return_url?: string }): Promise<BillingPortalSessionResponse> {
      return billingJson("/billing/portal-session", { method: "POST", jsonBody: payload });
    },

    // Payment connections (billing-adjacent)
    async getPaymentConnections(): Promise<PaymentConnection[]> {
      const res = await dashboardJson<{ data: PaymentConnection[] } | PaymentConnection[]>(base, "/payments/connections", { method: "GET" }, f);
      return Array.isArray(res) ? res : (res?.data ?? []);
    },
    createStripeOnboardingLink(payload: { return_url?: string; refresh_url?: string; return_to?: "onboarding" | "payment-connections" }): Promise<PaymentOnboardingLinkResponse> {
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
    createMercadoPagoOAuthLink(payload?: { return_to?: "onboarding" | "payment-connections" }): Promise<{ url: string }> {
      return dashboardJson(base, "/merchants/me/payment-connections/mercadopago/oauth-link", { method: "POST", jsonBody: payload }, f);
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
