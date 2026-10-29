import type { StorefrontConversationInput, StorefrontConversationOutput } from "../../domain/ports/conversation.port.js";
import type { StoreToolHandlers } from "../../domain/tools/types.js";
import { callStorefrontTool } from "../../domain/tools/call-storefront-tool.js";
import { shippingReferenceCepSchema, storefrontShippingReferenceResultSchema } from "../../domain/contracts/storefront-shipping-reference.schemas.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";

/** Exact message emitted by ShippingQuoteBlock. Its caption is presentation,
 * never product/variant authority; the authenticated cart owns the quotation. */
export function nativeShippingReferenceCep(message: string): string | undefined {
  const prefix = "Calcular frete para ";
  if (!message.startsWith(prefix)) return undefined;
  const marker = message.lastIndexOf(" CEP ");
  const caption = message.slice(prefix.length, marker);
  if (marker < prefix.length || !caption.trim() || caption.length > 1000 || /[\r\n]/.test(caption)) return undefined;
  const cep = shippingReferenceCepSchema.safeParse(message.slice(marker + 5));
  return cep.success ? cep.data : undefined;
}

/** Called only after the adapter's domain gate. No cart writer, model-generated
 * arguments, tariff estimate, selection or payment is used for this form. */
export async function resolveNativeShippingReference(input: Pick<StorefrontConversationInput, "merchantId" | "sessionId" | "cartId" | "userMessage">,
  quote: StoreToolHandlers["quoteShipping"]): Promise<StorefrontConversationOutput | undefined> {
  const zipCode = nativeShippingReferenceCep(input.userMessage);
  if (!zipCode) return undefined;
  const cartId = input.cartId || input.sessionId;
  const unavailable = () => ({ message: "Não foi possível consultar o frete agora. Confira o carrinho e tente novamente.",
    blocks: [], cartId, suggestedNext: ["Ver Carrinho"] });
  try {
    const result = await callStorefrontTool("quote_shipping", { zipCode }, args => quote(args as { zipCode: string }), { cartId });
    if (!result.ok) return unavailable();
    const shipping = storefrontShippingReferenceResultSchema.parse(result.data);
    if (!shipping.options.length) return {
      message: ["cart_required", "cart_empty", "product_selection_required"].includes(shipping.reason ?? "")
        ? "Escolha a variação do produto e adicione ao carrinho para consultar o frete."
        : shipping.message ?? unavailable().message,
      blocks: [], cartId, suggestedNext: ["Ver Produtos", "Ver Carrinho"],
    };
    const built = buildConversationBlocks({ merchantId: input.merchantId, userMessage: input.userMessage,
      finalContent: "", toolResults: { quote_shipping: shipping } });
    return { message: built.finalContent, blocks: built.blocks, cartId, suggestedNext: ["Ver Carrinho", "Finalizar Compra"] };
  } catch { return unavailable(); }
}
