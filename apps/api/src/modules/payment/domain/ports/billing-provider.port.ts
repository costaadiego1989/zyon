import type { BillingPlan } from "../payment-platform.types.js";

export const BILLING_PROVIDER = Symbol("BILLING_PROVIDER");

export interface BillingCustomerInput {
  merchantId: string;
  name: string;
  email: string;
  cpfCnpj?: string;
}

export interface BillingCreditCard {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface BillingCreditCardHolderInfo {
  name: string;
  email: string;
  cpfCnpj: string;
  postalCode: string;
  addressNumber: string;
  phone: string;
}

export interface CreateSubscriptionInput {
  customerId: string;
  planKey: BillingPlan;
  valueBrl: number;
  /** Tokenized card reference (preferred). */
  creditCardToken?: string;
  /** Raw card (when no token) — never logged. */
  creditCard?: BillingCreditCard;
  creditCardHolderInfo?: BillingCreditCardHolderInfo;
  remoteIp?: string;
}

export interface SubscriptionResult {
  subscriptionId: string;
  status: string;
}

/**
 * Recurring subscription billing provider (the platform charging merchants for
 * their SaaS plan). Distinct from PaymentProviderPort (merchants charging their
 * own buyers). Implemented by AsaasBillingProvider.
 */
export interface BillingProviderPort {
  createCustomer(input: BillingCustomerInput): Promise<{ customerId: string }>;
  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResult>;
  /** Change the recurring amount (plan change). */
  updateSubscription(input: { subscriptionId: string; valueBrl: number }): Promise<{ status: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getSubscription(subscriptionId: string): Promise<{ status: string; nextDueDate?: string } | null>;
}
