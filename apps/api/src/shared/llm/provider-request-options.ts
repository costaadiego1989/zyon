/** Keep the checkout's bounded, non-thinking tool protocol explicit. The
 * current DeepSeek API defaults to thinking and would otherwise require a
 * different tool history. Route aliases are not reliable provider identities. */
export function providerRequestOptions(endpoint: string, model: string): { thinking?: { type: "disabled" } } {
  let url: URL;
  try { url = new URL(endpoint); } catch { return {}; }
  if (url.protocol !== "https:" || url.hostname !== "api.deepseek.com"
    || !["deepseek-flash", "deepseek-v4-pro"].includes(model)) return {};
  return { thinking: { type: "disabled" } };
}
