import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
} from "@nestjs/common";
import {
  BillingPlanMeteringService,
} from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { BILLING_PLANS } from "../../../payment/domain/billing-plans.js";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";
import { GetProductContentUseCase } from "../../../catalog/application/use-cases/get-product-content.use-case.js";
import {
  DEFAULT_PRODUCT_CONTENT_LOCALE,
  normalizeProductContentLocale,
} from "../../../catalog/domain/entities/product-content-block.entity.js";
import { loadProductNoticeRules, productRuleNotices } from "../../infrastructure/product-rule-notices.js";
import { extractOptionGroups, toBlockOptionGroups } from "../../domain/food-options.js";

export const SUPPORTED_PRODUCT_CONTENT_LOCALES = ["pt-BR", "en", "es"] as const;

/**
 * Parse an `Accept-Language` header into a single best-match locale tag.
 *
 * Examples:
 *   "pt-BR,pt;q=0.9,en;q=0.8" → "pt-BR"
 *   "en-US,en;q=0.9"          → "en"
 *   "fr-CH, fr;q=0.9, *;q=0.1" → falls back to default ("pt-BR")
 *   undefined / empty         → default locale ("pt-BR")
 *
 * The resolver prefers supported locales that appear in the header (with
 * their quality weights) and falls back to default if no supported locale is
 * present. Quality-factor comparison follows RFC 7231.
 */
export function resolveLocaleFromAcceptLanguage(
  header: string | undefined | null
): string {
  if (!header || typeof header !== "string") {
    return DEFAULT_PRODUCT_CONTENT_LOCALE;
  }
  const parts = header.split(",").map((seg) => seg.trim()).filter(Boolean);
  if (parts.length === 0) {
    return DEFAULT_PRODUCT_CONTENT_LOCALE;
  }
  const candidates: Array<{ tag: string; q: number }> = [];
  for (const part of parts) {
    const segments = part.split(";").map((s) => s.trim());
    const rawTag = segments[0];
    if (!rawTag || rawTag === "*") continue;
    let q = 1.0;
    for (const s of segments.slice(1)) {
      const m = /^q\s*=\s*([0-9.]+)$/.exec(s);
      if (m) {
        const v = Number(m[1]);
        if (!Number.isNaN(v) && v >= 0 && v <= 1) q = v;
      }
    }
    candidates.push({ tag: rawTag, q });
  }
  if (candidates.length === 0) return DEFAULT_PRODUCT_CONTENT_LOCALE;

  // Score each supported locale against the candidates. Best score wins.
  // Match priority: exact tag > language-only prefix (en matches en-US).
  let best = { locale: DEFAULT_PRODUCT_CONTENT_LOCALE, score: -1 };
  for (const supported of SUPPORTED_PRODUCT_CONTENT_LOCALES) {
    const supportedLang = supported.split("-")[0]!.toLowerCase();
    let bestScore = -1;
    for (const c of candidates) {
      const candTag = c.tag.toLowerCase();
      if (candTag === supported.toLowerCase()) {
        bestScore = Math.max(bestScore, 1000 + c.q);
      } else if (candTag === supportedLang || candTag.startsWith(supportedLang + "-")) {
        bestScore = Math.max(bestScore, 100 + c.q);
      }
    }
    if (bestScore > best.score) {
      best = { locale: supported, score: bestScore };
    }
  }
  return best.locale;
}

/**
 * Public read endpoint for the rich product content surface.
 *
 * This is intentionally a public endpoint: storefront visitors do not carry a
 * merchant JWT. It resolves the merchant from the slug first, then evaluates
 * the feature entitlement for that exact merchant. Merchants without the
 * feature receive 404 so the capability is not exposed publicly.
 *
 * Wave 3: locale is resolved from the `Accept-Language` request header and
 * forwarded to the use case so each tenant returns content tagged for the
 * requested language. Fallback: `pt-BR`.
 */
@Controller("storefront")
export class StorefrontProductContentController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly getProductContent: GetProductContentUseCase,
    private readonly billing: BillingPlanMeteringService,
  ) {}

  @Get(":slug/products/:productId/content")
  async getContent(
    @Param("slug") slug: string,
    @Param("productId") productId: string,
    @Headers("accept-language") acceptLanguage?: string,
  ) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { storeSlug: slug },
      select: { id: true, storeSlug: true },
    });
    if (!merchant || !merchant.storeSlug) {
      throw new NotFoundException({ code: "store_not_found" });
    }

    const plan = await this.billing.getEffectivePlan(merchant.id);
    if (!BILLING_PLANS[plan].features.advancedProductLayout) {
      throw new NotFoundException({ code: "product_content_not_found" });
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId: merchant.id, isActive: true, deletedAt: null },
      select: {
        id: true,
        merchantId: true,
        name: true,
        description: true,
        type: true,
        metadata: true,
        variants: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            attributes: true,
            sku: true,
            price: { select: { basePriceInCents: true, currency: true } },
            media: {
              where: { type: "IMAGE" },
              orderBy: { order: "asc" },
              take: 8,
              select: { url: true, alt: true },
            },
            stock: { select: { quantity: true, reserved: true } },
          },
        },
      },
    });
    if (!product) {
      throw new NotFoundException({ code: "product_not_found" });
    }

    const locale = normalizeProductContentLocale(
      resolveLocaleFromAcceptLanguage(acceptLanguage)
    );

    const content = await this.getProductContent.execute({
      merchantId: merchant.id,
      productId: product.id,
      locale,
    });

    // Rich-content CTAs carry only a server-selected variant identifier. The
    // conversation/cart path still rechecks price, stock and checkout rules;
    // no amount or discount is trusted from the browser.
    const variants = product.variants.map((variant) => {
      const availableQuantity = variant.stock.reduce(
        (available, stock) => available + stock.quantity - stock.reserved,
        0,
      );
      const isAvailable = Boolean(variant.price) && (product.type !== "physical" || availableQuantity > 0);
      const attributes = Object.fromEntries(
        Object.entries((variant.attributes ?? {}) as Record<string, unknown>)
          .filter(([key, value]) => key.trim().length > 0 && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
          .slice(0, 12)
          .map(([key, value]) => [key.slice(0, 80), String(value).slice(0, 160)]),
      );
      return {
        id: variant.id,
        attributes,
        available: isAvailable,
        priceReais: variant.price ? variant.price.basePriceInCents / 100 : null,
        currency: variant.price?.currency ?? "BRL",
        lowStock: product.type === "physical" && availableQuantity > 0 && availableQuantity <= 5,
      };
    });
    const noticeRules = await loadProductNoticeRules(this.prisma, merchant.id);
    const ruleNotices = productRuleNotices(noticeRules, product.variants.map((variant) => variant.sku), product.id);
    const purchasableVariant = variants.find((variant) => variant.available);

    return {
      merchantId: merchant.id,
      productId: product.id,
      purchase: {
            productName: product.name,
            ...(ruleNotices.length > 0 ? { ruleNotices } : {}),
            description: product.description,
            defaultVariantId: purchasableVariant?.id ?? null,
            priceReais: (purchasableVariant ?? variants[0])?.priceReais ?? null,
            currency: (purchasableVariant ?? variants[0])?.currency ?? "BRL",
            variants,
            images: product.variants.flatMap((variant) => (variant.media ?? []).map((media) => ({
              src: media.url,
              alt: media.alt ?? product.name,
              variantId: variant.id,
            }))),
            isDemo: Boolean(product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata) && product.metadata.demo === true),
            // The cart validates every selected id again and recomputes its
            // amount from the catalog before the order can proceed.
            optionGroups: toBlockOptionGroups(extractOptionGroups(product.metadata)),
          },
      ...content,
    };
  }
}
