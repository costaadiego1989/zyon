import type { WhatsAppStructuredResponse } from "./meta-ui.types.js";

export type PresentationAsset = `${"welcome-v2" | "cart-added-v1" | "cart-empty-v1" | "payment-paid-v1" | "order-shipped-v1"}.${"mp4" | "webp" | "gif"}`;

export function presentationAssetUrl(asset: PresentationAsset, configuredOrigin = process.env.API_PUBLIC_URL || process.env.PUBLIC_API_BASE_URL || process.env.PUBLIC_API_URL || ""): string | undefined {
  try {
    const origin = new URL(configuredOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password) return;
    return new URL(`/whatsapp/presentation/${asset}`, origin).href;
  } catch { return; }
}

/** Presentation follows the canonical tool result, never the assistant's prose. */
export function withCartAnimations(response: WhatsAppStructuredResponse, configuredOrigin?: string): WhatsAppStructuredResponse {
  const added = response.blocks.some(block => block.type === "cart_add_result" && (block.data as any).status === "succeeded");
  const cart = response.blocks.find(block => block.type === "cart_summary")?.data as { items?: unknown[] } | undefined;
  const empty = Array.isArray(cart?.items) && cart.items.length === 0;
  const asset = added ? "cart-added-v1.webp" : empty && !response.state.cartEmptyAnimationShown ? "cart-empty-v1.webp" : undefined;
  const url = asset && presentationAssetUrl(asset, configuredOrigin);
  return { ...response, blocks: url ? [{ type: "commerce_animation", data: { url, kind: added ? "cart_added" : "cart_empty" } }, ...response.blocks] : response.blocks,
    state: { ...response.state, cartEmptyAnimationShown: added || Array.isArray(cart?.items) && !empty ? false : url && empty ? true : response.state.cartEmptyAnimationShown } };
}
