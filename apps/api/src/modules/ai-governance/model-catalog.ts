import { providerName } from "../ai-metering/usage.js";
export function deployedModels(env: Record<string,string|undefined> = process.env): Set<string> {
  const models = new Set<string>();
  const add = (url: string, values: Array<string|undefined>) => {
    for (const value of values) if (value?.trim()) models.add(providerName(url) + ":" + value.trim());
  };
  const openai = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const deepseek = env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
  const openrouter = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const local = env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1";
  add(openai, [env.OPENAI_MODEL, env.OPENAI_VISION_MODEL, env.OPENAI_REALTIME_MODEL, env.OPENAI_TRANSCRIPTION_MODEL,
    "gpt-4o-mini", "gpt-realtime-2.1-mini", "gpt-4o-mini-transcribe", "text-embedding-3-small"]);
  add(deepseek, [env.DEEPSEEK_MODEL,env.REVENUE_DEEPSEEK_MODEL,env.DEEPSEEK_VISION_MODEL,env.OPENAI_MODEL,"deepseek-chat","deepseek-flash"]);
  add(openrouter, [env.OPENROUTER_MODEL,"anthropic/claude-sonnet-4","deepseek/deepseek-chat","deepseek-chat","openai/gpt-4o-mini"]);
  add(local,[env.LOCAL_LLM_MODEL,"llama3.2","mistral"]);
  add(env.LOCAL_LLM_BASE_URL || env.OPENROUTER_BASE_URL || openrouter,[env.LOCAL_LLM_MODEL,env.OPENROUTER_MODEL,"deepseek-chat"]);
  add(env.EMBEDDING_BASE_URL || openai,[env.EMBEDDING_MODEL,"text-embedding-3-small"]);
  return models;
}
