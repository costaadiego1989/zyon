import { createHash } from "node:crypto";
import { CHECKOUT_CHAT_PROGRAM, buildCheckoutChatPrompt, checkoutChatTools,
  type ChatPromptPart, type CheckoutChatPromptInput, type LlmToolDefinition } from "./checkout-chat-prompt.js";
import { CHECKOUT_CHAT_SAMPLING, checkoutChatProviders } from "./checkout-chat-provider.js";
import { CHECKOUT_CHAT_BINDINGS_VERSION } from "./checkout-chat-context.js";

export interface CheckoutChatBaseline {
  definition: "checkout-chat-baseline-v1";
  scope: "primary_llm_turn_only";
  merchantId: string;
  merchantName: string;
  runtimeRevision: string;
  renderer: typeof CHECKOUT_CHAT_BINDINGS_VERSION;
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

/** Requires a pinned deployment and one explicit provider. It is a recipe for
 * primary LLM turns, not an approval, assignment or replay of the whole checkout. */
export function captureCheckoutChatBaseline(input: Pick<CheckoutChatBaseline,
  "merchantId" | "merchantName" | "rules" | "settingsHash" | "policyHash">,
  env: NodeJS.ProcessEnv = process.env): CheckoutChatBaseline | undefined {
  if (env.REVENUE_CHECKOUT_CONTRACT_ENABLED !== "true"
    || !/^[a-f0-9]{40,64}$/.test(env.CHECKOUT_BEHAVIOR_REVISION ?? "")
    || !env.CHECKOUT_LLM_PROVIDER?.trim()) return undefined;
  const routes = checkoutChatProviders(env);
  if (routes.length !== 1) return undefined;
  const route = routes[0];
  const value: CheckoutChatBaseline = { definition: "checkout-chat-baseline-v1", scope: "primary_llm_turn_only",
    ...input, runtimeRevision: env.CHECKOUT_BEHAVIOR_REVISION!, renderer: CHECKOUT_CHAT_BINDINGS_VERSION,
    program: structuredClone([...CHECKOUT_CHAT_PROGRAM]), tools: checkoutChatTools(), sampling: { ...CHECKOUT_CHAT_SAMPLING },
    provider: { name: route.name, model: route.model, endpointHash: checkoutContractHash(route.url), timeoutMs: route.timeoutMs } };
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 100_000) return undefined;
  return structuredClone(value);
}

export function assertCheckoutChatBaseline(baseline: CheckoutChatBaseline, merchantId: string): void {
  if (baseline.definition !== "checkout-chat-baseline-v1" || baseline.scope !== "primary_llm_turn_only"
    || baseline.merchantId !== merchantId || baseline.renderer !== CHECKOUT_CHAT_BINDINGS_VERSION
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
