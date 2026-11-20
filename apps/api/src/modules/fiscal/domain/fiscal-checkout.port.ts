import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import type { FiscalSnapshotContext } from "./fiscal-sale-snapshot.port.js";
import type { FiscalRecipient, FiscalRecipientField } from "./fiscal-recipient.js";

export const FISCAL_BEFORE_PAYMENT = Symbol("FISCAL_BEFORE_PAYMENT");
export interface FiscalBeforePaymentPort {
  assertBeforePayment(session: CheckoutSession, options?: { persist?: boolean }): Promise<void>;
  requirements?(session: CheckoutSession): Promise<FiscalRecipientField[]>;
  resolveRecipient?(session: CheckoutSession): Promise<FiscalRecipient>;
}
export interface FiscalCheckoutSellerContext extends FiscalSnapshotContext {
  lines: { sku: string; productType: string }[];
}
export interface FiscalCheckoutReaderPort { load(session: CheckoutSession): Promise<FiscalCheckoutSellerContext[]> }
export function fiscalRecipientFromCustomer(customer?: CustomerHints): FiscalRecipient {
  const explicit = customer?.fiscalRecipient;
  if (customer?.fiscalRecipientMode === "other" || customer?.fiscalRecipientMode === undefined && explicit && Object.keys(explicit).length) return structuredClone(explicit ?? {});
  const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
  const personal = { name: customer?.fullName, taxId: customer?.cpf, email: customer?.email, phone: customer?.phone,
    ...(customer?.address ? { address: { street: customer.address.street, number: customer.address.number,
      complement: customer.address.complement, neighborhood: customer.address.neighborhood, city: customer.address.city,
      state: customer.address.state, postalCode: customer.address.zip } } : {}) };
  return { ...(explicit ?? {}), ...defined(personal), ...(personal.address || explicit?.address ? {
    address: { ...explicit?.address, ...defined(personal.address ?? {}) } } : {}) };
}
