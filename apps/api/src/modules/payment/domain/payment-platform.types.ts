export type PaymentConnectionProvider = "stripe" | "asaas";
export type BillingPlan = "starter" | "growth" | "scale";
export type PaymentConnectionEnvironment = "test" | "live";
export type PaymentConnectionStatus =
  | "pending"
  | "restricted"
  | "active"
  | "degraded";

export interface PaymentConnectionSnapshot {
  merchantId: string;
  provider: PaymentConnectionProvider;
  environment: PaymentConnectionEnvironment;
  status: PaymentConnectionStatus;
  externalAccountId?: string;
  walletId?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirements: string[];
  lastSyncedAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "cancelled"
  | "incomplete";

export interface BillingSubscriptionSnapshot {
  merchantId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  status: BillingSubscriptionStatus;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AsaasSubaccountInput {
  name: string;
  email: string;
  loginEmail?: string;
  cpfCnpj: string;
  birthDate?: string;
  companyType?: "MEI" | "LIMITED" | "INDIVIDUAL" | "ASSOCIATION";
  phone?: string;
  mobilePhone: string;
  site?: string;
  incomeValue: number;
  address: string;
  addressNumber: string;
  complement?: string;
  province: string;
  postalCode: string;
}
