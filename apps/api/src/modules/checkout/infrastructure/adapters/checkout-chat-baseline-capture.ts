import { type CheckoutChatBaseline, checkoutContractHash } from "../../domain/services/checkout-chat-baseline.js";
import { CHECKOUT_CHAT_PROGRAM, checkoutChatTools } from "../../domain/services/checkout-chat-prompt.js";
import { CHECKOUT_CHAT_SAMPLING, checkoutChatProviders } from "./checkout-chat-provider.js";
import { CHECKOUT_CHAT_BINDINGS_VERSION } from "../../domain/services/checkout-chat-context.js";
import { CHECKOUT_PAYMENT_ROUTING_VERSION } from "../../domain/services/chat-payment-selection.js";
import { CHECKOUT_CHAT_NAVIGATION_VERSION } from "../../domain/services/checkout-chat-navigation.js";
import { STRATEGY_CHAT_CONTEXT_EXIT_VERSION, STRATEGY_CHAT_SUPPRESSION_RECOVERY_VERSION } from "../../domain/services/strategy-chat-context-exit.js";

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
    paymentRouting: CHECKOUT_PAYMENT_ROUTING_VERSION,
    navigation: CHECKOUT_CHAT_NAVIGATION_VERSION,
    contextExit: STRATEGY_CHAT_CONTEXT_EXIT_VERSION,
    suppressionRecovery: STRATEGY_CHAT_SUPPRESSION_RECOVERY_VERSION,
    program: structuredClone([...CHECKOUT_CHAT_PROGRAM]), tools: checkoutChatTools(), sampling: { ...CHECKOUT_CHAT_SAMPLING },
    provider: { name: route.name, model: route.model, endpointHash: checkoutContractHash(route.url), timeoutMs: route.timeoutMs } };
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 100_000) return undefined;
  return structuredClone(value);
}
