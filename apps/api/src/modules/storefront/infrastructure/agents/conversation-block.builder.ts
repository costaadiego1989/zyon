import type { ConversationBlock, MarketplaceProductBlockData, MarketplaceProductsBlock } from "../../domain/types/conversation-block.js";

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

/** A rating is only meaningful when it comes with actual product reviews. */
function productRating(product: { rating?: unknown; reviewCount?: unknown }): number | undefined {
  return typeof product.reviewCount === "number" && product.reviewCount > 0
    && typeof product.rating === "number" && Number.isFinite(product.rating) && product.rating >= 1 && product.rating <= 5
    ? product.rating : undefined;
}

function presentedVariant(variant: any, productType?: string) {
  const labels: Record<string, string> = { color: "Cor", size: "Tamanho", material: "Material", weight: "Peso", length: "Comprimento", width: "Largura", height: "Altura", style: "Estilo", flavor: "Sabor", voltage: "Voltagem", capacity: "Capacidade", model: "Modelo", edition: "Edição", pack: "Pacote", type: "Tipo", format: "Formato" };
  const attribute = Object.keys(variant.attributes ?? {})[0] ?? "SKU";
  const tracksQuantity = productType !== "digital" && productType !== "service";
  const stock = tracksQuantity && typeof variant.stockQuantity === "number"
    ? Math.max(0, variant.stockQuantity - (variant.stockReserved ?? 0)) : undefined;
  const price = variant.basePriceInCents ?? variant.price;
  return { id: variant.id ?? variant.sku, name: labels[attribute.toLowerCase()] ?? attribute,
    value: Object.values(variant.attributes ?? {})[0] as string ?? variant.sku ?? variant.id,
    sku: variant.sku, stock, price,
    priceFormatted: typeof price === "number" ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(price / 100) : undefined };
}

function marketplaceProductsBlock(products: MarketplaceProductBlockData[], query: string): MarketplaceProductsBlock {
  return {
    type: "marketplace_products",
    data: {
      query,
      // Keep the authenticated catalog IDs, prices and availability. Selection belongs to the buyer's card.
      products: products.map(product => ({
        id: product.id,
        name: product.name,
        price: product.price,
        priceFormatted: product.priceFormatted,
        image: product.image,
        sellerName: product.sellerName,
        sellerId: product.sellerId,
        inStock: product.inStock,
        variants: product.variants.map(variant => ({
          id: variant.id,
          label: variant.label,
          price: variant.price,
          priceFormatted: variant.priceFormatted,
          inStock: variant.inStock,
        })),
      })),
    },
  };
}

export function buildConversationBlocks(input: BuildBlocksInput): BuildBlocksResult {
  const blocks: ConversationBlock[] = [];
  let finalContent = input.finalContent;
  const toolResults = input.toolResults;
  const userMessage = input.userMessage;
  const addItemResult = toolResults["add_item_to_cart"] as any;
  if (typeof addItemResult?.error === "string" && /^service_(?:slot|schedule)_/.test(addItemResult.error)) {
    return { blocks: [], finalContent: "Não foi possível adicionar esse horário. Revise a data e o horário oferecidos antes de tentar novamente." };
  }
  if (typeof addItemResult?.error === "string" && (/^food_option_/.test(addItemResult.error)
    || ["required_group_missing", "unknown_option_item", "single_group_multiple_selected"].includes(addItemResult.error))) {
    return { blocks: [], finalContent: "Não foi possível adicionar essa combinação. Revise as opções do produto e os limites de seleção." };
  }
  if (addItemResult?.error === "variant_out_of_stock" || addItemResult?.error === "marketplace_insufficient_stock") {
    return { blocks: [], finalContent: "A quantidade escolhida não está disponível em estoque. Escolha outra quantidade ou produto." };
  }
  if (addItemResult?.error === "stock_validation_unavailable") {
    return { blocks: [], finalContent: "Não foi possível consultar o estoque agora. Tente novamente em alguns instantes." };
  }
  if (addItemResult?.error === "digital_content_unavailable" || addItemResult?.error === "product_unavailable") {
    return { blocks: [], finalContent: "Este produto está indisponível no momento. Escolha outro produto." };
  }
  if (addItemResult?.error === "marketplace_tool_binding_invalid") {
    // A model-supplied binding cannot identify a canonical product or authorize prior checkout results.
    return { blocks: [], finalContent: "Não consegui identificar esse produto. Busque novamente e escolha uma opção no catálogo." };
  }
  if (addItemResult?.error === "marketplace_variant_selection_required") {
    // A refusal owns this turn. Old cart/coupon/checkout results cannot confirm the addition or prepare OneBuyClick.
    return {
      blocks: addItemResult.marketplaceProduct ? [marketplaceProductsBlock([addItemResult.marketplaceProduct], userMessage)] : [],
      finalContent: addItemResult.marketplaceProduct
        ? "Escolha uma opção do produto e clique em Adicionar ao carrinho."
        : "Não consegui carregar as opções do produto. Tente buscar novamente.",
    };
  }

  const skipProductCarousel = !!toolResults["add_item_to_cart"] || !!toolResults["get_product_details"];
  const isDetailIntent = /detalh|saber mais|informa[cç]|especifica|mais sobre|me fale|conte.*sobre/i.test(userMessage);
  const searchData = toolResults["search_products"] as any;
  const marketplaceSearchProducts = Array.isArray(searchData?.marketplaceProducts) ? searchData.marketplaceProducts : [];
  const singleSearchAsDetail = !toolResults["get_product_details"] && isDetailIntent
    && searchData?.products?.length === 1 && marketplaceSearchProducts.length === 0;

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
        ruleNotices: p.ruleNotices,
        price,
        priceFormatted: formatPrice(price),
        image: p.image,
        images: p.images ?? (p.image ? [p.image] : []),
        inStock: p.inStock ?? true,
        rating: productRating(p),
        reviewCount: p.reviewCount ?? 0,
        detailed: true,
        productType: p.type ?? p.productType,
        serviceSchedule: p.serviceSchedule,
        stock: p.inStock ? undefined : 0,
        sku: p.variants?.[0]?.sku ?? p.variants?.[0]?.id,
        variants: p.variants?.map((v: any) => presentedVariant(v, p.type ?? p.productType)),
        optionGroups: Array.isArray(p.optionGroups) && p.optionGroups.length > 0 ? p.optionGroups : undefined,
      }
    } as any);
    if ((p.type ?? p.productType) === "digital" && typeof p.inStock === "boolean") {
      finalContent = p.inStock ? `${p.name} está disponível. O acesso digital será liberado após a confirmação do pagamento.`
        : `${p.name} está indisponível no momento. Posso ajudar a encontrar outro produto?`;
    } else if (!finalContent || finalContent.trim().length === 0) {
      finalContent = "Aqui estão os detalhes completos:";
    }
  } else if (toolResults["search_products"] && !skipProductCarousel) {
    const searchData = toolResults["search_products"] as any;
    if (searchData?.products?.length > 0) {
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      blocks.push({
        type: "product_carousel",
        data: {
          products: searchData.products.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            ruleNotices: p.ruleNotices,
            price: p.price,
            priceFormatted: formatPrice(p.price),
            image: p.image,
            images: p.images ?? (p.image ? [p.image] : []),
            inStock: p.inStock ?? true,
            rating: productRating(p),
            reviewCount: p.reviewCount,
            variants: p.variants?.map((v: any) => presentedVariant(v, p.type ?? p.productType)),
            optionGroups: Array.isArray(p.optionGroups) && p.optionGroups.length > 0 ? p.optionGroups : undefined,
            productType: p.type ?? p.productType,
            serviceSchedule: p.serviceSchedule,
            source: p.source ?? "local",
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
  if (marketplaceSearchProducts.length > 0 && !skipProductCarousel) {
    blocks.push(marketplaceProductsBlock(marketplaceSearchProducts, userMessage));
  }
  const skipProductCard = !!toolResults["get_similar_products"] || !!toolResults["compare_products"];
  const detailData = toolResults["get_product_details"] as any;
  if (detailData?.marketplaceProduct) {
    blocks.push(marketplaceProductsBlock([detailData.marketplaceProduct], userMessage));
    if (!finalContent || finalContent.trim().length === 0) {
      finalContent = "Confira as opções deste produto da loja parceira:";
    }
  } else if (toolResults["get_product_details"] && !skipProductCard) {
    if (detailData?.product) {
      const p = detailData.product;
      const variants = Array.isArray(p.variants) ? p.variants.filter((variant: any) => variant.isActive !== false) : [];
      const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
      const price = variants[0]?.basePriceInCents ?? p.price ?? 0;
      const isDigitalOrService = p.type === "digital" || p.type === "service";
      blocks.push({
        type: "product_card",
        data: {
          id: p.id,
          name: p.name,
          description: p.description,
          ruleNotices: p.ruleNotices,
          price,
          priceFormatted: formatPrice(price),
          image: Array.isArray(p.images) ? p.images[0] : p.image ?? p.media?.find((media: { type?: string }) => media.type === "IMAGE")?.url,
          images: p.images ?? p.media?.filter((media: { type?: string }) => media.type === "IMAGE").map((media: { url: string }) => media.url) ?? (p.image ? [p.image] : []),
          inStock: typeof p.inStock === "boolean" ? p.inStock : p.type === "service" || (!isDigitalOrService && (p.stock ?? 0) > 0),
          rating: productRating(p),
          reviewCount: p.reviewCount ?? 0,
          detailed: true,
          stock: isDigitalOrService ? undefined : (p.stock ?? 0),
          productType: p.type,
          serviceSchedule: p.serviceSchedule,
          sku: variants[0]?.sku,
          variants: variants.map((v: any) => presentedVariant(v, p.type)),
          optionGroups: Array.isArray(p.optionGroups) && p.optionGroups.length > 0 ? p.optionGroups : undefined,
        }
      });

      if (!addItemResult && p.type === "digital" && typeof p.inStock === "boolean") {
        // Physical quantity zero is not evidence of digital unavailability.
        finalContent = p.inStock
          ? `${p.name} está disponível. O acesso digital será liberado após a confirmação do pagamento.`
          : `${p.name} está indisponível no momento. Posso ajudar a encontrar outro produto?`;
      } else if (!finalContent || finalContent.trim().length === 0) {
        finalContent = "Aqui estão os detalhes completos:";
      }
    } else {
      finalContent = detailData?.error === "product_not_found"
        ? "Desculpe, não encontrei esse produto no catálogo. Posso ajudar com outra coisa?"
        : "Não consegui carregar os detalhes do produto. Tente novamente ou escolha outro produto.";
    }
  }
  const skipCartBlock = !!toolResults["quote_shipping"];
 
  const couponResult = (toolResults["apply_coupon"] ?? toolResults["remove_coupon"]) as any;
  if (couponResult?.applied && couponResult?.items?.length > 0 && !skipCartBlock) {
    blocks.push({
      type: "cart_summary",
      data: {
        cartId: couponResult.cartId,
        items: couponResult.items.map((i: any) => ({
          variantId: i.variantId,
          productName: i.name,
          quantity: i.quantity,
          price: i.unitPrice,
          subtotal: i.lineTotal ?? i.unitPrice * i.quantity,
          imageUrl: i.imageUrl,
          selectedOptions: i.selectedOptions,
          selectedServiceSlotId: i.selectedServiceSlot?.slotId,
        })),
        itemCount: couponResult.itemCount,
        subtotal: couponResult.total,
        discount: couponResult.discount ?? 0,
        couponCode: couponResult.couponCode ?? null,
        freeShipping: false,
        total: (couponResult.total ?? 0) - (couponResult.discount ?? 0),
      }
    });
  }

  if (addItemResult?.error === "variant_selection_required" && addItemResult.variantSelection?.variants?.length > 0) {
    const selection = addItemResult.variantSelection;
    blocks.push({
      type: "variant_selector",
      data: {
        productId: selection.productId,
        productName: selection.productName,
        groups: [{
          name: "Variação",
          options: selection.variants.map((variant: { id: string; label: string }) => ({
            id: variant.id,
            value: variant.label,
            available: true,
          })),
        }],
      },
    });
    finalContent = "Qual variação você prefere?";
  }

  const latestCart = toolResults["clear_cart"] ?? toolResults["update_cart_item"] ?? toolResults["remove_cart_item"] ?? toolResults["add_item_to_cart"] ?? toolResults["get_cart"];
  const added = addItemResult?.addedItem;
  if (!addItemResult?.error && typeof addItemResult?.cartId === "string" && typeof added?.variantId === "string"
    && Array.isArray(addItemResult.items) && addItemResult.items.some((item: any) => item.variantId === added.variantId
      && item.quantity > 0 && (item.selectedServiceSlot?.slotId ?? undefined) === (added.serviceSlotId ?? undefined))) {
    blocks.push({ type: "cart_add_result", data: { cartId: addItemResult.cartId, variantId: added.variantId,
      serviceSlotId: added.serviceSlotId, optionItemIds: added.optionItemIds ?? [], status: "succeeded" } });
  }
  if (latestCart) {
    const cartData = latestCart as any;
    if (!cartData?.error && Array.isArray(cartData?.items) && !couponResult?.applied) {
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
            imageUrl: i.imageUrl,
            selectedOptions: i.selectedOptions,
            selectedServiceSlotId: i.selectedServiceSlot?.slotId,
          })),
          itemCount: cartData.itemCount,
          confirmedAddition: latestCart === toolResults["add_item_to_cart"],
          subtotal: cartData.total,
          discount: cartData.discount ?? 0,
          freeShipping: cartData.freeShipping ?? false,
          total: cartData.total - (cartData.discount ?? 0),
          nextNudge: cartData.nextNudge ?? undefined,
          activeRules: cartData.activeRules ?? undefined,
        }
      });
    }
  }
  const suggestionData = (toolResults["add_item_to_cart"] ?? toolResults["get_product_details"]) as any;
  if (suggestionData) {
    const cartData = suggestionData;
    if (cartData?.crossSellSuggestions?.length > 0) {
      const formatPrice = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
      blocks.push({
        type: "cross_sell",
        data: {
          trigger: "Produtos que podem complementar seu pedido",
          displayMode: cartData.crossSellDisplayMode ?? "interstitial",
          products: cartData.crossSellSuggestions.map((p: any) => ({
            id: p.sku,
            name: p.name,
            price: p.price,
            priceFormatted: formatPrice(p.price),
            image: p.imageUrl,
            inStock: true,
            discountPercent: p.discountPercent,
            promoId: p.promoId,
            couponCode: p.couponCode,
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
    if (compareData?.comparison?.length > 1) {
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
          })),
          missingProductNames: Array.isArray(compareData.missingProductNames)
            ? compareData.missingProductNames
            : undefined,
        }
      });
    } else if (compareData?.requiresProductNames && !finalContent.trim()) {
      finalContent = "Não encontrei produtos semelhantes suficientes. Diga os nomes dos produtos que deseja comparar.";
    }
  }
  const wishlistData = (
    toolResults["add_to_wishlist"]
    ?? toolResults["get_wishlist"]
    ?? toolResults["remove_from_wishlist"]
  ) as any;
  if (wishlistData && Array.isArray(wishlistData.items)) {
    const formatPrice = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
    blocks.push({
      type: "wishlist",
      data: {
        items: wishlistData.items.map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          price: item.price ?? 0,
          priceFormatted: item.priceFormatted ?? formatPrice(item.price ?? 0),
          image: item.image,
          images: item.images,
          inStock: item.inStock !== false,
          rating: item.rating,
          reviewCount: item.reviewCount ?? 0,
        })),
      },
    });
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
            images: p.images ?? (p.image ? [p.image] : []),
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
            originalPrice: p.originalPrice,
            originalPriceFormatted: p.originalPrice ? formatPrice(p.originalPrice) : undefined,
            discountPercent: p.discountPercent,
            image: p.image,
            images: p.images ?? (p.image ? [p.image] : []),
            inStock: p.inStock ?? true,
          })),
          merchantId: input.merchantId,
        }
      });
    }
  }
  if (toolResults["create_checkout_session"]) {
    const checkoutData = toolResults["create_checkout_session"] as any;
    if (checkoutData?.checkoutPrepared) {
      blocks.push({
        type: "checkout_prepared",
        data: {
          actionId: checkoutData.actionId,
          cartId: checkoutData.cartId,
          shippingPreference: checkoutData.shippingPreference,
          paymentPreference: checkoutData.paymentPreference,
        },
      } as any);
    } else if (checkoutData?.checkoutUrl) {
      blocks.push({
        type: "checkout_redirect",
        data: {
          url: checkoutData.checkoutUrl,
          sessionId: checkoutData.sessionId ?? "",
        }
      } as any);
    }
  }

  // Coupons + progressive + advanced rules → coupon_list card block.
  if (toolResults["list_promotions"]) {
    const promoData = toolResults["list_promotions"] as any;
    const coupons = Array.isArray(promoData?.coupons) ? promoData.coupons : (Array.isArray(promoData?.promotions) ? promoData.promotions : []);
    const progressive = promoData?.progressive;
    const advancedRules = Array.isArray(promoData?.advancedRules) ? promoData.advancedRules : [];
    if (coupons.length > 0 || progressive || advancedRules.length > 0) {
      const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
      blocks.push({
        type: "coupon_list",
        data: {
          coupons: coupons.map((c: any) => ({
            code: c.code,
            description: c.description,
            minCartValue: typeof c.minCartValue === "number" ? c.minCartValue : undefined,
            minCartValueFormatted: typeof c.minCartValue === "number" && c.minCartValue > 0 ? fmt(c.minCartValue) : undefined,
            expiresAt: c.expiresAt ?? null,
          })),
          progressive: progressive ? { maxPercent: progressive.maxPercent, description: progressive.description } : undefined,
          advancedRules: advancedRules.map((r: any) => ({ label: r.label })),
        }
      } as any);
    }
  }

  return { blocks, finalContent };
}
