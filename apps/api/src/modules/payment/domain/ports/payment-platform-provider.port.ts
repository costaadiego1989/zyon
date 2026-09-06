import type {
  AsaasSubaccountInput,
  BillingPlan,
  BillingSubscriptionStatus,
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
  retrieveBillingSubscription(subscriptionId: string): Promise<StripeBillingSubscription>;
  listBillingInvoices(customerId: string): Promise<StripeBillingInvoice[]>;
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

export interface StripeBillingSubscription {
  merchantId?: string;
  customerId: string;
  subscriptionId: string;
  priceId?: string;
  status: BillingSubscriptionStatus;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
}

export interface StripeBillingInvoice {
  id: string;
  amountBrl: number;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  invoiceUrl?: string;
}

export interface AsaasPlatformPort {
  /** Only the operator-configured platform merchant can reuse the root account. */
  resolvePlatformAccount(merchantId: string, cpfCnpj: string): Promise<{ apiKey: string; walletId: string } | null>;
  createSubaccount(
    input: AsaasSubaccountInput,
  ): Promise<{
    accountId: string;
    walletId: string;
    apiKey: string;
  }>;
  retrieveAccountStatus(apiKey: string, sandbox?: boolean): Promise<{
    general: string;
    commercialInfo: string;
    bankAccountInfo: string;
    documentation: string;
  }>;
  listOnboardingLinks(apiKey: string, sandbox?: boolean): Promise<string[]>;
  /** Finds an existing subaccount on the root account by CPF/CNPJ (digits only). */
  findSubaccountByCpfCnpj(cpfCnpj: string): Promise<{ accountId: string; email?: string } | null>;
  /** Generates a fresh API key for an existing subaccount (apiKey is only returned once at creation). */
  createSubaccountApiKey(accountId: string): Promise<{ apiKey: string }>;
  /** Retrieves the walletId for a subaccount, called with that subaccount's own apiKey. */
  retrieveWalletId(apiKey: string, sandbox?: boolean): Promise<string | null>;
  /** SANDBOX ONLY: instantly approves the subaccount's commercial data + docs. */
  approveSandboxAccount(apiKey: string): Promise<void>;
}
