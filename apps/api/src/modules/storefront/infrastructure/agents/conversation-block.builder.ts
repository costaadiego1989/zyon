import type { ConversationBlock } from "../../domain/types/conversation-block.js";

export interface BuildBlocksInput {
  toolResults: Record<string, unknown>;
  userMessage: string;
  finalContent: string;
  merchantId: string;
}

export interface BuildBlocksResult {
  blocks: ConversationBlock[];
  finalContent: string;
}

export function buildConversationBlocks(input: BuildBlocksInput): BuildBlocksResult {
  const blocks: ConversationBlock[] = [];
  let finalContent = input.finalContent;
  const toolResults = input.toolResults;
  const userMessage = input.userMessage;

  const skipProductCarousel = !!toolResults["add_item_to_cart"] || !!toolResults["get_product_details"];
  const isDetailIntent = /detalh|saber mais|informa[cç]|especifica|mais sobre|me fale|conte.*sobre/i.test(userMessage);
  const searchData = toolResults["search_products"] as any;
  const singleSearchAsDetail = !toolResults["get_product_details"] && isDetailIntent && searchData?.products?.length === 1;

  if (singleSearchAsDetail) {
    const p = searchData.products[0];
    const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
    const price = p.price ?? 0;
    blocks.push({
      type: "product_card",
      data: {
        id: p.id,
        name: p.name,
        description: p.description,
        price,
        priceFormatted: formatPrice(price),
        image: p.image,
        inStock: p.inStock ?? true,
        rating: p.rating ?? undefined,
        reviewCount: p.reviewCount ?? 0,
        detailed: true,
        stock: p.inStock ? undefined : 0,
        sku: p.variants?.[0]?.sku ?? p.variants?.[0]?.id,
        variants: p.variants?.map((v: any) => {
          const ATTR_LABELS: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato" };
          const rawName = Object.keys(v.attributes ?? {})[0] ?? "SKU";
          const name = ATTR_LABELS[rawName.toLowerCase()] ?? rawName;
          const value = Object.values(v.attributes ?? {})[0] as string ?? v.sku ?? v.id;
          return { id: v.id ?? v.sku, name, value, price: v.basePriceInCents ?? v.price ?? undefined, priceFormatted: v.basePriceInCents ? formatPrice(v.basePriceInCents) : undefined };
        }),
        optionGroups: Array.isArray(p.optionGroups) && p.optionGroups.length > 0 ? p.optionGroups : undefined,
      }
    } as any);
    if (!finalContent || finalContent.trim().length === 0) {
      finalContent = "Aqui estão os detalhes completos:";
    }
  } else if (toolResults["search_products"] && !skipProductCarousel) {
    const searchData = toolResults["search_products"] as any;
    if (searchData?.products?.length > 0) {
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      const isMarketplaceSource = searchData.source === "marketplace" || searchData.source === "mixed";
      blocks.push({
        type: "product_carousel",
        data: {
          products: searchData.products.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: p.price,
            priceFormatted: formatPrice(p.price),
            image: p.image,
            images: p.images ?? (p.image ? [p.image] : []),
            inStock: p.inStock ?? true,
            rating: p.rating,
            reviewCount: p.reviewCount,
            variants: p.variants?.map((v: any) => {
              const ATTR_LABELS: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato" };
              const rawName = Object.keys(v.attributes ?? {})[0] ?? "SKU";
              const name = ATTR_LABELS[rawName.toLowerCase()] ?? rawName;
              const value = Object.values(v.attributes ?? {})[0] as string ?? v.sku ?? v.id;
              return { id: v.id ?? v.sku, name, value, price: v.basePriceInCents ?? v.price ?? undefined };
            }),
            optionGroups: Array.isArray(p.optionGroups) && p.optionGroups.length > 0 ? p.optionGroups : undefined,
            source: p.source ?? (isMarketplaceSource ? "marketplace" : "local"),
            sellerName: p.sellerName ?? undefined,
            sellerMerchantId: p.sellerMerchantId,
          })),
          nextCursor: searchData.nextCursor,
          merchantId: input.merchantId,
          query: undefined,
          categoryId: undefined,
        }
      });
    }
  }
  const skipProductCard = !!toolResults["get_similar_products"] || !!toolResults["compare_products"];
  if (toolResults["get_product_details"] && !skipProductCard) {
    const detailData = toolResults["get_product_details"] as any;
    if (detailData?.product) {
      const p = detailData.product;
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      const price = p.variants?.[0]?.basePriceInCents ?? p.price ?? 0;
      const isDigitalOrService = p.type === "digital" || p.type === "service";
      blocks.push({
        type: "product_card",
        data: {
          id: p.id,
          name: p.name,
          description: p.description,
          price,
          priceFormatted: formatPrice(price),
          image: p.media?.[0]?.url ?? p.image,
          inStock: isDigitalOrService || (p.stock ?? 0) > 0,
          rating: p.rating ?? 4.3,
          reviewCount: p.reviewCount ?? 0,
          detailed: true,
          stock: isDigitalOrService ? 999 : (p.stock ?? 0),
          sku: p.variants?.[0]?.sku,
          variants: p.variants?.map((v: any) => {
            const ATTR_LABELS: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato", length: "Comprimento", width: "Largura", height: "Altura" };
            const rawName = Object.keys(v.attributes ?? {})[0] ?? "SKU";
            const name = ATTR_LABELS[rawName.toLowerCase()] ?? rawName;
            const value = Object.values(v.attributes ?? {})[0] as string ?? v.sku;
            const variantStock = isDigitalOrService ? 999 : Math.max(0, (v.stockQuantity ?? 0) - (v.stockReserved ?? 0));
            return { id: v.id ?? v.sku, name, value, sku: v.sku, stock: variantStock, price: v.basePriceInCents ?? undefined, priceFormatted: v.basePriceInCents ? formatPrice(v.basePriceInCents) : undefined };
          }),
          optionGroups: Array.isArray(p.optionGroups) && p.optionGroups.length > 0 ? p.optionGroups : undefined,
        }
      });

      if (!finalContent || finalContent.trim().length === 0) {
        finalContent = "Aqui estão os detalhes completos:";
      }
    } else {
      finalContent = detailData?.error === "product_not_found"
        ? "Desculpe, não encontrei esse produto no catálogo. Posso ajudar com outra coisa?"
        : "Não consegui carregar os detalhes do produto. Tente novamente ou escolha outro produto.";
    }
  }
  const skipCartBlock = !!toolResults["quote_shipping"];
  if (toolResults["get_cart"] && !skipCartBlock) {
    const cartData = toolResults["get_cart"] as any;
    if (cartData?.items?.length > 0) {
      blocks.push({
        type: "cart_summary",
        data: {
          cartId: cartData.cartId,
          items: cartData.items.map((i: any) => ({
            variantId: i.variantId,
            productName: i.name,
            quantity: i.quantity,
            price: i.unitPrice,
            subtotal: i.lineTotal ?? i.unitPrice * i.quantity,
          })),
          itemCount: cartData.itemCount,
          subtotal: cartData.total,
          discount: cartData.discount,
          total: cartData.total - (cartData.discount ?? 0),
        }
      });
    }
  }
  if (toolResults["add_item_to_cart"] && !skipCartBlock) {
    const cartData = toolResults["add_item_to_cart"] as any;
    if (cartData?.items?.length > 0) {
      blocks.push({
        type: "cart_summary",
        data: {
          cartId: cartData.cartId,
          items: cartData.items.map((i: any) => ({
            variantId: i.variantId,
            productName: i.name,
            quantity: i.quantity,
            price: i.unitPrice,
            subtotal: i.lineTotal ?? i.unitPrice * i.quantity,
          })),
          itemCount: cartData.itemCount,
          subtotal: cartData.total,
          discount: 0,
          total: cartData.total,
        }
      });
    }
    if (cartData?.crossSellSuggestions?.length > 0) {
      const formatPrice = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
      blocks.push({
        type: "cross_sell",
        data: {
          trigger: "Complete seu pedido e economize — quem levou este produto também garantiu:",
          products: cartData.crossSellSuggestions.map((p: any) => ({
            id: p.sku,
            name: p.name,
            price: p.price,
            priceFormatted: formatPrice(p.price),
            image: p.imageUrl,
            inStock: true,
            discountPercent: p.discountPercent,
          })),
        }
      } as any);
    }
  }
  if (toolResults["quote_shipping"]) {
    const shippingData = toolResults["quote_shipping"] as any;
    if (shippingData?.options?.length > 0) {
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      blocks.push({
        type: "shipping_options",
        data: {
          options: shippingData.options.map((o: any) => ({
            carrier: o.carrier,
            name: o.name,
            price: o.price,
            priceFormatted: formatPrice(o.price),
            days: o.days,
          }))
        }
      });
    }
  }
  if (toolResults["compare_products"]) {
    const compareData = toolResults["compare_products"] as any;
    if (compareData?.comparison?.length > 0) {
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      blocks.push({
        type: "product_comparison",
        data: {
          products: compareData.comparison.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            priceFormatted: formatPrice(p.price),
            rating: p.rating,
            inStock: p.type === "digital" || p.type === "service" || (p.stock ?? 0) > 0,
            attributes: p.attributes ?? {},
          }))
        }
      });
    }
  }
  const skipCategoryCarousel = !!toolResults["search_products"];
  if (toolResults["list_categories"] && !skipCategoryCarousel) {
    const catData = toolResults["list_categories"] as any;
    if (catData?.categories?.length > 0) {
      blocks.push({
        type: "category_carousel",
        data: {
          categories: catData.categories.map((c: any) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            productCount: c.productCount ?? 0,
          }))
        }
      } as any);
    }
  }
  if (toolResults["get_reviews"]) {
    const reviewsData = toolResults["get_reviews"] as any;
    if (reviewsData?.reviews?.length > 0) {
      blocks.push({
        type: "reviews",
        data: {
          productId: "",
          productName: "",
          averageRating: reviewsData.averageRating ?? 4.5,
          totalReviews: reviewsData.totalCount ?? reviewsData.reviews.length,
          reviews: reviewsData.reviews.map((r: any) => ({
            id: r.id,
            author: r.author,
            rating: r.rating,
            text: r.text,
            date: r.date,
          })),
        }
      } as any);
    }
  }
  if (toolResults["get_similar_products"]) {
    const similarData = toolResults["get_similar_products"] as any;
    if (similarData?.products?.length > 0) {
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      blocks.push({
        type: "cross_sell",
        data: {
          trigger: "similar",
          products: similarData.products.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            priceFormatted: formatPrice(p.price),
            image: p.image,
            inStock: p.inStock ?? true,
          }))
        }
      } as any);
    }
  }
  if (toolResults["get_daily_deals"]) {
    const dealsData = toolResults["get_daily_deals"] as any;
    if (dealsData?.deals?.length > 0) {
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      blocks.push({
        type: "product_carousel",
        data: {
          products: dealsData.deals.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            priceFormatted: formatPrice(p.price),
            image: p.image,
            inStock: p.inStock ?? true,
            discountPercent: p.discountPercent,
          })),
          merchantId: input.merchantId,
        }
      });
    }
  }
  if (toolResults["create_checkout_session"]) {
    const checkoutData = toolResults["create_checkout_session"] as any;
    if (checkoutData?.checkoutUrl) {
      blocks.push({
        type: "checkout_redirect",
        data: {
          url: checkoutData.checkoutUrl,
          sessionId: checkoutData.sessionId ?? "",
        }
      } as any);
    }
  }

  return { blocks, finalContent };
}
