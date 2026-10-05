export { CHECKOUT_CHAT_SAMPLING } from "../../domain/services/checkout-chat-sampling.js";
export type CheckoutChatProvider = { name: string; url: string; key: string; model: string; timeoutMs: number };

/** Same ordered routes for runtime and baseline inspection. Never serialize keys. */
export function checkoutChatProviders(env: NodeJS.ProcessEnv = process.env): CheckoutChatProvider[] {
  const selected = env.CHECKOUT_LLM_PROVIDER?.trim().toLowerCase();
  if (selected && !["local", "openrouter", "openai", "deepseek"].includes(selected)) return [];
  const use = (provider: string) => !selected || selected === provider;
  // A validated checkout rollout must not silently migrate catalog, support
  // and storefront adapters that share the legacy provider environment.
  const modelFor = (fallback: string) => selected ? env.CHECKOUT_LLM_MODEL?.trim() || fallback : fallback;
  const localUrl = env.LOCAL_LLM_BASE_URL || env.OLLAMA_BASE_URL;
  const routes: CheckoutChatProvider[] = [];
  if (localUrl && use("local")) routes.push({ name: "local", url: `${localUrl}/chat/completions`,
    key: env.LOCAL_LLM_API_KEY || "ollama", model: modelFor(env.LOCAL_LLM_MODEL || env.OLLAMA_MODEL || "llama3.1:8b"),
    timeoutMs: ["deepseek", "openrouter", "openai"].some(name => localUrl.includes(name)) ? 30_000 : 5_000 });
  for (const [name, prefix, defaultUrl, defaultModel] of [
    ["openrouter", "OPENROUTER", "https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4"],
    ["openai", "OPENAI", "https://api.openai.com/v1", "gpt-4o-mini"],
    ["deepseek", "DEEPSEEK", "https://api.deepseek.com/v1", "deepseek-chat"],
  ]) {
    const key = env[`${prefix}_API_KEY`];
    if (key && use(name) && !localUrl?.includes(name)) routes.push({ name, key,
      url: `${(env[`${prefix}_BASE_URL`] || defaultUrl).replace(/\/+$/, "")}/chat/completions`,
      model: modelFor(env[`${prefix}_MODEL`] || defaultModel), timeoutMs: 30_000 });
  }
  return routes;
}
