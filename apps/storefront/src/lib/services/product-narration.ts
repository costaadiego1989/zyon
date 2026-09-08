import type { ProductContentPurchaseResponse } from "@/lib/api/product-content";

export type ProductVoicePlayback = { stop: () => void };
/** Future professional voice adapters keep this lifecycle and the visible transcript. */
export interface ProductVoiceProvider {
  available(): boolean;
  speak(text: string, callbacks: { onStart: () => void; onEnd: () => void; onError: () => void }): ProductVoicePlayback;
}

export const browserProductVoice: ProductVoiceProvider = {
  available: () => typeof window !== "undefined" && typeof window.speechSynthesis?.speak === "function" && typeof window.SpeechSynthesisUtterance === "function",
  speak(text, callbacks) {
    const synthesis = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    let finished = false;
    const finish = (failed: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(startTimer);
      if (failed) callbacks.onError(); else callbacks.onEnd();
    };
    utterance.lang = "pt-BR";
    utterance.rate = 1;
    const voices = synthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.replace("_", "-").toLowerCase() === "pt-br")
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("pt")) ?? null;
    utterance.onstart = () => { window.clearTimeout(startTimer); if (!finished) callbacks.onStart(); };
    utterance.onend = () => finish(false);
    utterance.onerror = () => finish(true);
    // Autoplay can be denied silently, especially on mobile and direct links.
    const startTimer = window.setTimeout(() => { finish(true); synthesis.cancel(); }, 3000);
    synthesis.cancel();
    try { synthesis.speak(utterance); } catch { finish(true); }
    return { stop() {
      if (finished) return;
      finished = true;
      window.clearTimeout(startTimer);
      utterance.onstart = utterance.onend = utterance.onerror = null;
      synthesis.cancel();
    } };
  },
};

/** Catalog facts only: no generated discounts, efficacy claims or invented delivery promises. */
export function buildProductNarration(purchase: ProductContentPurchaseResponse): string {
  const plain = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const name = plain(purchase.productName).slice(0, 160);
  const description = plain(purchase.description ?? "");
  const shortDescription = description.length <= 240 ? description : description.slice(0, 237).replace(/\s+\S*$/, "") + "…";
  const available = purchase.variants.filter((variant) => variant.available);
  const optionHint = purchase.optionGroups.length ? "Você pode montar seu pedido com as opções abaixo." : available.length > 1 ? "Escolha a versão que combina com você." : "";
  return [name + ".", shortDescription, optionHint, "Explore os detalhes enquanto eu te acompanho. Se precisar, é só voltar à conversa."]
    .filter(Boolean).join(" ");
}
