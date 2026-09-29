import type { ChatUiBlock, CheckoutSession } from "@zyon/shared-types";
import type { LlmCallResult } from "./checkout-chat-prompt.js";

export const CHECKOUT_CHAT_NAVIGATION_VERSION = "checkout-navigation-v1" as const;
export const MAIN_CHAT_PUBLICATION_POLICY = "main_chat_navigation_v2";
export const navigationToolNames = ["confirm_address", "request_cep", "show_shipping_options", "show_payment_methods"] as const;
type NavigationTool = typeof navigationToolNames[number];

/** Navigation takes no model-supplied data. Reject an entire mixed batch before
 * publishing anything; these tools never authorize, mutate or charge. */
export function checkoutNavigationTools(calls: LlmCallResult["toolCalls"]): NavigationTool[] | undefined {
  if (!Array.isArray(calls) || calls.length > navigationToolNames.length) return undefined;
  const names: NavigationTool[] = [];
  for (const call of calls) {
    const name = call?.function?.name as NavigationTool;
    if (!navigationToolNames.includes(name) || names.includes(name)) return undefined;
    let args: unknown = call.function?.arguments;
    if (typeof args === "string") { try { args = JSON.parse(args); } catch { return undefined; } }
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) return undefined;
    names.push(name);
  }
  return names;
}

/** Pure projection shared by normal and experimental chat. Context comes from
 * the server; external calls and cart mutation callbacks are deliberately absent. */
export function checkoutNavigationContext(session: CheckoutSession, cryptoEnabled = false) {
  const address = session.customer?.address;
  const formatted = address?.street
    ? `${address.street}, ${address.number ?? ""}${address.complement ? ", " + address.complement : ""} - ${address.city ?? ""}/${address.state ?? ""}`
    : undefined;
  const paymentMethods = [
    { key: "pix", label: "Pix", sub: "Pagamento instantâneo" },
    { key: "boleto", label: "Boleto", sub: "Pague pelo link seguro" },
    { key: "credito", label: "Cartão de crédito", sub: "Pagamento seguro com cartão" },
    { key: "debito", label: "Cartão de débito", sub: "Débito à vista" },
  ];
  if (cryptoEnabled) paymentMethods.push({ key: "crypto", label: "Crypto · USDC", sub: "Polygon ou Base" });
  const shippingOptions = session.shippingOptions?.flatMap((option, index) => {
    const cost = Math.round(option.customerPrice * 100);
    if (!Number.isSafeInteger(cost) || cost < 0) return [];
    const eta = Number.isSafeInteger(option.deliveryDays) && option.deliveryDays! > 0
      ? `${option.deliveryDays} dias úteis` : "Prazo a confirmar";
    return [{ key: `chat-shipping-${index}`, label: [option.carrier, option.method].filter(Boolean).join(" ") || "Frete",
      cost, tag: eta, sub: eta }];
  });
  return { shippingOptions, paymentMethods,
    address: formatted ? { ...address, formatted } : undefined };
}

export function checkoutNavigationBlock(name: string, context: {
  shippingOptions?: unknown[]; paymentMethods?: unknown[]; address?: { formatted?: string; [key: string]: unknown };
}): ChatUiBlock | undefined {
  switch (name) {
    case "confirm_address": return context.address?.formatted ? { type: "address_confirmation", data: context.address } : undefined;
    case "show_shipping_options": return context.shippingOptions?.length ? { type: "shipping_options", data: { options: context.shippingOptions, selection_mode: "chat" } } : undefined;
    case "show_payment_methods": return context.paymentMethods?.length ? { type: "payment_methods", data: { methods: context.paymentMethods } } : undefined;
    case "request_cep": return { type: "form_field", data: { field: "cep", label: "CEP de entrega", placeholder: "00000-000" } };
  }
}

export function checkoutNavigationBlocks(names: NavigationTool[], session: CheckoutSession): ChatUiBlock[] {
  const context = checkoutNavigationContext(session);
  return names.flatMap(name => { const block = checkoutNavigationBlock(name, context); return block ? [block] : []; });
}
