import { createHash } from "node:crypto";
import { CHECKOUT_CHAT_PROGRAM, buildCheckoutChatPrompt, checkoutChatTools,
  type ChatPromptPart, type CheckoutChatPromptInput, type LlmToolDefinition } from "./checkout-chat-prompt.js";
import { CHECKOUT_CHAT_SAMPLING } from "./checkout-chat-sampling.js";
import { CHECKOUT_CHAT_BINDINGS_VERSION } from "./checkout-chat-context.js";
import { CHECKOUT_PAYMENT_ROUTING_VERSION } from "./chat-payment-selection.js";
import { CHECKOUT_CHAT_NAVIGATION_VERSION } from "./checkout-chat-navigation.js";
import { STRATEGY_CHAT_CONTEXT_EXIT_VERSION, STRATEGY_CHAT_SUPPRESSION_RECOVERY_VERSION } from "./strategy-chat-context-exit.js";

export interface CheckoutChatBaseline {
  definition: "checkout-chat-baseline-v1";
  scope: "primary_llm_turn_only";
  merchantId: string;
  merchantName: string;
  runtimeRevision: string;
  renderer: typeof CHECKOUT_CHAT_BINDINGS_VERSION;
  paymentRouting: typeof CHECKOUT_PAYMENT_ROUTING_VERSION;
  navigation: typeof CHECKOUT_CHAT_NAVIGATION_VERSION;
  contextExit: typeof STRATEGY_CHAT_CONTEXT_EXIT_VERSION;
  suppressionRecovery: typeof STRATEGY_CHAT_SUPPRESSION_RECOVERY_VERSION;
  program: ChatPromptPart[];
  tools: LlmToolDefinition[];
  sampling: typeof CHECKOUT_CHAT_SAMPLING;
  provider: { name: string; model: string; endpointHash: string; timeoutMs: number };
  rules: { normal: string[]; paymentFailed: string[] };
  settingsHash: string;
  policyHash: string;
}

export function checkoutContractHash(value: unknown): string {
  const canonical = (input: any): any => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === "object" ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])])) : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function checkoutBaselineReference(baseline: CheckoutChatBaseline): string {
  return `checkout-chat-baseline-v1:${checkoutContractHash(baseline)}`;
}

export function assertCheckoutChatBaseline(baseline: CheckoutChatBaseline, merchantId: string): void {
  if (baseline.definition !== "checkout-chat-baseline-v1" || baseline.scope !== "primary_llm_turn_only"
    || baseline.merchantId !== merchantId || baseline.renderer !== CHECKOUT_CHAT_BINDINGS_VERSION
    || baseline.paymentRouting !== CHECKOUT_PAYMENT_ROUTING_VERSION
    || baseline.navigation !== CHECKOUT_CHAT_NAVIGATION_VERSION
    || baseline.contextExit !== STRATEGY_CHAT_CONTEXT_EXIT_VERSION
    || baseline.suppressionRecovery !== STRATEGY_CHAT_SUPPRESSION_RECOVERY_VERSION
    || checkoutContractHash(baseline.program) !== checkoutContractHash(CHECKOUT_CHAT_PROGRAM)
    || checkoutContractHash(baseline.tools) !== checkoutContractHash(checkoutChatTools())
    || checkoutContractHash(baseline.sampling) !== checkoutContractHash(CHECKOUT_CHAT_SAMPLING)) {
    throw new Error("CHECKOUT_BASELINE_INVALID");
  }
}

/** Control adds no text and retains dynamic cart, stage and consented intent.
 * The caller still owns authenticated tenant, routing, approval and exposure. */
export function renderCheckoutChatBaseline(baseline: CheckoutChatBaseline, merchantId: string,
  turn: Pick<CheckoutChatPromptInput, "cartInfo" | "stage" | "buyerIntent"> & { paymentJustFailed?: boolean }): string {
  assertCheckoutChatBaseline(baseline, merchantId);
  return buildCheckoutChatPrompt({ ...turn, merchantName: baseline.merchantName,
    merchantRules: turn.paymentJustFailed ? baseline.rules.paymentFailed : baseline.rules.normal }, baseline.program);
}
