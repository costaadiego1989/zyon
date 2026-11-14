import type { MetaUiMessage, MetaUiView } from "./meta-ui.types.js";
import { catalogResultCopy } from "../../../storefront/domain/services/catalog-result-copy.js";

/** Combine prose with its controls; raw Pix payloads keep their own message. */
export function compactMetaPresentation(messages: MetaUiMessage[], view: MetaUiView): MetaUiMessage[] {
  const prose = messages.filter((m): m is Extract<MetaUiMessage, { type: "text" }> => m.type === "text" && !/^\s*000201\S+\s*$/.test(m.text.body));
  if (!prose.length) return messages;
  const body = prose.map(m => m.text.body).join("\n\n");
  const last = messages.at(-1);
  const menu = last?.type === "interactive" && ["button", "list"].includes(String(last.interactive.type)) ? last : undefined;
  if (menu && !body.includes("```") && Array.from(body).length <= 1024 && !messages.some(m => m.type === "text" && /^\s*000201\S+\s*$/.test(m.text.body))) {
    const prompt = (menu.interactive.body as { text?: string } | undefined)?.text ?? "";
    const combinedBody = /^🤖 Como posso ajudar\?$/.test(body) ? prompt
      : /variação|Confirme o endereço|Consulte o frete novamente/.test(prompt) ? `${body}\n\n${prompt}` : body;
    if (Array.from(combinedBody).length > 1024) return messages;
    const combined: MetaUiMessage = { ...menu, interactive: { ...menu.interactive, body: { text: combinedBody } } };
    const remaining = messages.filter(m => !prose.includes(m as any) && m !== menu);
    return view.blocks.some(b => ["welcome_animation", "commerce_animation", "payment_paid_animation"].includes(b.type)) ? [combined, ...remaining] : [...remaining, combined];
  }
  // Keep every fact when a long cart exceeds the interactive body's limit.
  // Merge only adjacent prose so media and raw payment payloads retain order.
  const first = messages.indexOf(prose[0]!);
  if (prose.length > 1 && body.length <= 4096 && messages.slice(first, first + prose.length).every(m => prose.includes(m as any))) {
    return messages.flatMap((m, index) => index === first ? [{ type: "text" as const, text: { body } }] : prose.includes(m as any) ? [] : [m]);
  }
  return messages;
}

/** The count describes this read, never the store's entire inventory. */
export function metaCatalogCopy(message: string, blocks: MetaUiView["blocks"]): string {
  if (!blocks.length || !blocks.every(b => ["product_carousel", "text", "message"].includes(b.type))) return message;
  const catalogs = blocks.filter(b => b.type === "product_carousel");
  const count = catalogs.reduce((n, b) => n + (Array.isArray((b.data as any).products) ? (b.data as any).products.length : 0), 0);
  if (!count) return message;
  const lead = `Confira ${count === 1 ? "o produto" : `os ${count} produtos`} desta lista.`;
  const browse = catalogs.every(b => !((b.data as any).criteria) && (!((b.data as any).query) || (b.data as any).query === "*"));
  if (browse && /^(?:Estes são os produtos disponíveis:?|Encontrei estas opções no catálogo(?: da loja)?\.?)$/i.test(message.trim()))
    return `${lead}${catalogs.some(b => (b.data as any).nextCursor) ? " Há mais opções na próxima página." : ""}\nAbra um produto para ver fotos e detalhes.`;
  return catalogResultCopy(message, count);
}
