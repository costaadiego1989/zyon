/**
 * Pure mapping from AACP CheckoutSession (internal) to ACP canonical checkout
 * session shape (public agentic-protocol contract).
 *
 * Mapping rules:
 *   - status: AACP `pending` -> ACP `not_ready_for_payment`
 *             AACP `awaiting_payment` -> ACP `ready_for_payment`
 *             AACP `completed` -> ACP `completed`
 *             AACP `canceled` -> ACP `canceled`
 *   - currency: lowercased ISO 4217 ("BRL" -> "brl")
 *   - amounts: cents (smallest currency unit); AACP uses decimal major units
 *   - line_items: from CartItem[] with base_amount = price * quantity (cents)
 *   - fulfillment_options: from shippingOptions[] with customerPrice in cents
 *   - fulfillment_address: from customer.address (optional)
 *   - totals: always emits the canonical ACP total line items
 *
 * All transforms are pure — no I/O, no side effects.
 */
import type { CartItem, CheckoutSession, CurrencyCode, ShippingQuote } from "@zyon/shared-types";

export type AcpCheckoutStatus =
  | "not_ready_for_payment"
  | "ready_for_payment"
  | "completed"
  | "canceled";

export type AcpFulfillmentType = "shipping";

export interface AcpFulfillmentAddress {
  name: string;
  line_one: string;
  line_two?: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
}

export interface AcpFulfillmentOption {
  type: AcpFulfillmentType;
  id: string;
  title: string;
  subtitle?: string;
  carrier?: string;
  amount: number;
  estimated_delivery_days?: number;
}

export interface AcpLineItem {
  id: string;
  item: { id: string; quantity: number };
  base_amount: number;
  discount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export type AcpTotalType =
  | "items_base_amount"
  | "subtotal"
  | "tax"
  | "discount"
  | "fulfillment"
  | "fee"
  | "total";

export interface AcpTotalLine {
  type: AcpTotalType;
  display_text: string;
  amount: number;
}

export interface AcpCheckoutSession {
  id: string;
  status: AcpCheckoutStatus;
  currency: string;
  line_items: AcpLineItem[];
  fulfillment_address?: AcpFulfillmentAddress;
  fulfillment_options: AcpFulfillmentOption[];
  fulfillment_option_id?: string;
  totals: AcpTotalLine[];
  created_at: string;
  updated_at: string;
}

const STATUS_MAP: Record<string, AcpCheckoutStatus> = {
  pending: "not_ready_for_payment",
  awaiting_payment: "ready_for_payment",
  completed: "completed",
  canceled: "canceled",
  cancelled: "canceled",
};

const SUPPORTED_CURRENCIES: ReadonlyArray<CurrencyCode> = ["BRL", "USD", "EUR"];

function toCents(major: number | undefined | null): number {
  if (major === null || major === undefined || Number.isNaN(major)) return 0;
  return Math.round(major * 100);
}

function lowerCurrency(currency: string | undefined): string {
  if (!currency) return "brl";
  const upper = currency.toUpperCase();
  if ((SUPPORTED_CURRENCIES as ReadonlyArray<string>).includes(upper)) {
    return upper.toLowerCase();
  }
  return currency.toLowerCase();
}

function mapStatus(status: string | undefined): AcpCheckoutStatus {
  if (!status) return "not_ready_for_payment";
  return STATUS_MAP[status] ?? "not_ready_for_payment";
}

function mapFulfillmentAddress(
  customer: CheckoutSession["customer"],
): AcpFulfillmentAddress | undefined {
  const addr = customer?.address;
  if (!addr) return undefined;
  const lineOne = [addr.street, addr.number].filter(Boolean).join(", ");
  if (!lineOne) return undefined;
  return {
    name: customer?.fullName ?? "",
    line_one: lineOne,
    line_two: addr.complement ?? undefined,
    city: addr.city ?? "",
    state: addr.state ?? "",
    country: "BR",
    postal_code: addr.zip ?? "",
  };
}

function mapFulfillmentOptions(
  shippingOptions: ShippingQuote[] | undefined,
  selected: ShippingQuote | undefined,
): { options: AcpFulfillmentOption[]; selectedId?: string } {
  const list = shippingOptions ?? (selected ? [selected] : []);
  const options = list.map((quote, idx) => ({
    type: "shipping" as const,
    id: `${quote.carrier ?? quote.method ?? "shipping"}-${idx}`,
    title: quote.method ?? quote.carrier ?? "Shipping",
    subtitle: quote.carrier ?? undefined,
    carrier: quote.carrier,
    amount: toCents(quote.customerPrice),
    estimated_delivery_days: quote.deliveryDays,
  }));
  const selectedId = selected
    ? `${selected.carrier ?? selected.method ?? "shipping"}-0`
    : undefined;
  return { options, selectedId };
}

function mapLineItems(items: CartItem[] | undefined): AcpLineItem[] {
  if (!items || items.length === 0) return [];
  return items.map((item) => {
    const qty = Math.max(1, Math.floor(item.quantity || 0));
    const base = toCents(item.price) * qty;
    return {
      id: item.sku,
      item: { id: item.sku, quantity: qty },
      base_amount: base,
      discount: 0,
      subtotal: base,
      tax: 0,
      total: base,
    };
  });
}

export interface CheckoutSessionMapperInput {
  session: CheckoutSession;
  aacpStatus?: string;
}

export class CheckoutSessionMapper {
  static toAcp(input: CheckoutSessionMapperInput): AcpCheckoutSession {
    const { session, aacpStatus } = input;
    const cart = session.cart ?? { items: [], total: 0, currency: "BRL" as CurrencyCode };
    const items = cart.items ?? [];
    const lineItems = mapLineItems(items);

    const { options: fulfillmentOptions, selectedId } = mapFulfillmentOptions(
      session.shippingOptions,
      session.shipping,
    );

    const itemsBase = lineItems.reduce((sum, li) => sum + li.base_amount, 0);
    const discount = toCents(cart.currentDiscount);
    const subtotal = Math.max(0, itemsBase - discount);
    const fulfillmentAmount = session.shipping
      ? toCents(session.shipping.customerPrice)
      : 0;
    const total = subtotal + fulfillmentAmount;

    const currency = lowerCurrency(cart.currency);

    return {
      id: session.sessionId,
      status: mapStatus(aacpStatus),
      currency,
      line_items: lineItems,
      fulfillment_address: mapFulfillmentAddress(session.customer),
      fulfillment_options: fulfillmentOptions,
      fulfillment_option_id: selectedId,
      totals: [
        {
          type: "items_base_amount",
          display_text: "Items",
          amount: itemsBase,
        },
        { type: "discount", display_text: "Discount", amount: discount },
        { type: "subtotal", display_text: "Subtotal", amount: subtotal },
        {
          type: "fulfillment",
          display_text: "Shipping",
          amount: fulfillmentAmount,
        },
        { type: "total", display_text: "Total", amount: total },
      ],
      created_at: session.createdAt ?? new Date().toISOString(),
      updated_at: session.updatedAt ?? new Date().toISOString(),
    };
  }
}
