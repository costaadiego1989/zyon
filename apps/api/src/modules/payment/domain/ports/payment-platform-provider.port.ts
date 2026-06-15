import type {
  AsaasSubaccountInput,
  BillingPlan,
} from "../payment-platform.types.js";

export const STRIPE_PLATFORM_PORT = Symbol("STRIPE_PLATFORM_PORT");
export const ASAAS_PLATFORM_PORT = Symbol("ASAAS_PLATFORM_PORT");
export const PAYMENT_PLATFORM_ENVIRONMENT = Symbol(
  "PAYMENT_PLATFORM_ENVIRONMENT",
);
export const BILLING_CONFIG_PORT = Symbol("BILLING_CONFIG_PORT");

export interface PaymentPlatformEnvironment {
  stripe: "test" | "live";
  asaas: "test" | "live";
}

export interface BillingConfigPort {
  priceId(plan: BillingPlan): string;
  consoleUrl(): string;
}

export interface StripeConnectAccountStatus {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirements: string[];
}

export interface StripePlatformPort {
  createConnectAccount(input: {
    merchantId: string;
    merchantName: string;
    email: string;
  }): Promise<{ accountId: string }>;
  createConnectOnboardingLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt?: string }>;
  retrieveConnectAccount(
    accountId: string,
  ): Promise<StripeConnectAccountStatus>;
  createBillingCustomer(input: {
    merchantId: string;
    merchantName: string;
    email: string;
  }): Promise<{ customerId: string }>;
  createSubscriptionCheckout(input: {
    merchantId: string;
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }>;
  createBillingPortal(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}

export interface AsaasPlatformPort {
  createSubaccount(
    input: AsaasSubaccountInput,
  ): Promise<{
    accountId: string;
    walletId: string;
    apiKey: string;
  }>;
  retrieveAccountStatus(apiKey: string): Promise<{
    general: string;
    commercialInfo: string;
    bankAccountInfo: string;
    documentation: string;
  }>;
  listOnboardingLinks(apiKey: string): Promise<string[]>;
}
