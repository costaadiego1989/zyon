export type Usage = {
  input: number; output: number; total: number;
  inputDetails: Record<string, number>; outputDetails: Record<string, number>;
};
export type Rates = Record<string, string>;
export function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : undefined;
}
function details(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(object(value))) {
    if (!["text_tokens", "audio_tokens", "image_tokens", "cached_tokens", "cache_read", "cache_creation", "cache_write_tokens", "reasoning_tokens", "reasoning"].includes(key)) continue;
    const n = integer(raw); if (n !== undefined) out[key] = n;
  }
  const cache = object(object(value).cached_tokens_details);
  for (const key of ["text_tokens", "audio_tokens", "image_tokens"]) { const n = integer(cache[key]); if (n !== undefined) out["cached_" + key] = n; }
  return out;
}
/** Missing/invalid provider usage is never silently converted to zero. */
export function normalizeUsage(payload: unknown, embedding = false): Usage | undefined {
  const root = object(payload), u = object(root.usage_metadata ?? root.usage ?? root);
  const input = integer(u.input_tokens ?? u.prompt_tokens);
  const output = embedding ? 0 : integer(u.output_tokens ?? u.completion_tokens);
  const total = integer(u.total_tokens);
  if (input === undefined || output === undefined || (total !== undefined && total !== input + output)) return;
  const i = details(u.input_token_details ?? u.prompt_tokens_details), o = details(u.output_token_details ?? u.completion_tokens_details);
  const hit = integer(u.prompt_cache_hit_tokens), miss = integer(u.prompt_cache_miss_tokens);
  if (hit !== undefined) i.cached_tokens = hit;
  if (hit !== undefined && miss !== undefined && hit + miss !== input) return;
  for (const n of Object.values(i)) if (n > input) return;
  for (const n of Object.values(o)) if (n > output) return;
  if ((i.text_tokens ?? 0) + (i.audio_tokens ?? 0) + (i.image_tokens ?? 0) > input) return;
  if ((o.text_tokens ?? 0) + (o.audio_tokens ?? 0) > output) return;
  return { input, output, total: total ?? input + output, inputDetails: i, outputDetails: o };
}
/** Decimal strings -> integer micros; scientific notation and negative values are rejected. */
export function decimalMicros(value: unknown): bigint | undefined {
  if (typeof value !== "string" && typeof value !== "number") return;
  let text = String(value);
  const exponential = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d{1,2})$/.exec(text);
  if (exponential) {
    const digits=exponential[1]!+(exponential[2]??""),point=exponential[1]!.length+Number(exponential[3]);
    text=point<=0?"0."+"0".repeat(-point)+digits:point>=digits.length?digits+"0".repeat(point-digits.length):digits.slice(0,point)+"."+digits.slice(point);
  }
  if (!/^\d+(?:\.\d{1,18})?$/.test(text)) return;
  const [whole, fraction = ""] = text.split(".");
  const micros = BigInt(whole!) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  const result=micros + (/[1-9]/.test(fraction.slice(6)) ? 1n : 0n);
  return result<=9_223_372_036_854_775_807n?result:undefined;
}
function rate(rates: Rates, key: string): bigint | undefined {
  const raw = rates[key]; return typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
}
export function estimateCost(usage: Usage, rates: Rates): bigint | undefined {
  const { inputDetails: d, outputDetails: o } = usage;
  const realtime = rates.audio_input !== undefined;
  const terms: Array<[number, string]> = [];
  if (realtime) {
    const audioIn = d.audio_tokens ?? 0, imageIn = d.image_tokens ?? 0, textIn = d.text_tokens;
    const audioOut = o.audio_tokens ?? 0, textOut = o.text_tokens;
    if (textIn === undefined || textOut === undefined || textIn + audioIn + imageIn !== usage.input || textOut + audioOut !== usage.output) return;
    const cached = d.cached_tokens ?? d.cache_read ?? 0;
    const ca = d.cached_audio_tokens ?? (audioIn === 0 ? 0 : undefined), ct = d.cached_text_tokens ?? (textIn === 0 ? 0 : undefined), ci = d.cached_image_tokens ?? (imageIn === 0 ? 0 : undefined);
    if (cached && (ca === undefined || ct === undefined || ci === undefined || ca + ct + ci !== cached)) return;
    if ((ca ?? 0) > audioIn || (ct ?? 0) > textIn || (ci ?? 0) > imageIn) return;
    terms.push([audioIn - (ca ?? 0), "audio_input"], [ca ?? 0, "audio_cached"], [textIn - (ct ?? 0), "input"], [ct ?? 0, "cached"], [imageIn - (ci ?? 0), "image_input"], [ci ?? 0, "image_cached"], [audioOut, "audio_output"], [textOut, "output"]);
  } else {
    const cached = d.cached_tokens ?? d.cache_read ?? 0, write = d.cache_write_tokens ?? d.cache_creation ?? 0;
    if (cached + write > usage.input) return;
    terms.push([usage.input - cached - write, "input"], [cached, "cached"], [write, "cache_write"], [usage.output, "output"]);
  }
  let numerator = 0n;
  for (const [quantity, key] of terms) { if (!quantity) continue; const r = rate(rates, key); if (r === undefined) return; numerator += BigInt(quantity) * r; }
  return (numerator + 999_999n) / 1_000_000n;
}
export function providerName(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  return host === "api.openai.com" ? "openai" : host === "openrouter.ai" ? "openrouter" : host === "api.deepseek.com" ? "deepseek" : host;
}
export function ratesAt(rates: Rates, at: Date): Rates {
  if (rates.peak_multiplier !== "2") return rates;
  const hour=at.getUTCHours(),weekday=at.getUTCDay();
  if (weekday===0||weekday===6||!((hour>=1&&hour<4)||(hour>=6&&hour<10))) return rates;
  return Object.fromEntries(Object.entries(rates).map(([key,value])=>[key,["input","cached","output","cache_write"].includes(key)&&/^\d+$/.test(value)?(BigInt(value)*2n).toString():value]));
}
