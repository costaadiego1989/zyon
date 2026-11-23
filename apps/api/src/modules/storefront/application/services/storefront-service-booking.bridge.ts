import type { PrismaClient } from "@prisma/client";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { EmbedTokenService } from "../../../embed/domain/embed-token.service.js";
import { ResolveEmbedBuyerService } from "../../../embed/application/resolve-embed-buyer.service.js";
import { readTrustedStorefrontOrigin } from "../../../embed/presentation/http/embed-auth.guard.js";
import { serviceBookingScopeFromVerifiedBuyer } from "../../../checkout/presentation/http/service-booking.controller.js";
import type { ServiceBookingScope, ServiceBookingService } from "../../../checkout/application/service-booking.service.js";
import type { StorefrontServiceBookingFactory, ScopedServiceBookingReader } from "../../domain/ports/service-booking-tools.port.js";
import { createServiceBookingHandlers } from "../../infrastructure/tool-handlers/service-booking.handlers.js";

type Headers = Record<string, string | string[] | undefined>;
interface Dependencies {
  prisma: PrismaClient;
  conversations: RealtimeCapabilityService;
  embeds: EmbedTokenService;
  resolveBuyer: ResolveEmbedBuyerService;
  booking: ServiceBookingService;
}
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const bearer = (value: string | undefined) => value?.startsWith("Bearer ") ? value.slice(7).trim() : undefined;
/** No issuer or new credential exists here. This bridge verifies the actual
 * existing credentials again, and keeps all authority outside serialized input. */
export class StorefrontServiceBookingBridge {
  constructor(private readonly deps: Dependencies, private readonly clock = () => new Date()) {}

  capture(request: { headers?: Headers; conversationId: string }): StorefrontServiceBookingFactory {
    const allowed = ["authorization", "origin", "referer", "x-internal-service-token", "x-trusted-storefront-origin",
      "x-buyer-authorization", "x-aacp-embed-token", "x-embed-session-token"];
    const headers: Record<string, string | undefined> = {};
    for (const key of allowed) headers[key] = first(request.headers?.[key]);
    const conversationId = request.conversationId;
    const origin = readTrustedStorefrontOrigin(headers) ?? headers.origin;
    const conversation = () => this.deps.conversations.verify(bearer(headers.authorization), "storefront-conversation", origin);
    return async binding => {
      let claims;
      try { claims = conversation(); } catch { return undefined; }
      if (claims.resourceId !== conversationId || binding.merchantId !== claims.merchantId || binding.conversationId !== conversationId || binding.cartRef !== claims.resourceId) return undefined;
      const merchant = await this.deps.prisma.merchant.findUnique({ where: { id: claims.merchantId }, select: {
        businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
      if (merchant?.businessMode !== "services" || !merchant.businessModeSelectedAt || merchant.businessModeNeedsReview) return undefined;

      const scope = async (): Promise<ServiceBookingScope | undefined> => {
        try {
          const current = conversation();
          if (current.resourceId !== conversationId || current.merchantId !== claims.merchantId || !origin) return;
          const embedToken = headers["x-aacp-embed-token"] ?? headers["x-embed-session-token"], buyerToken = bearer(headers["x-buyer-authorization"]);
          if (!embedToken || !buyerToken) return;
          const embed = this.deps.embeds.verify(embedToken);
          if (embed.merchantId !== current.merchantId || embed.storefrontCartRef !== current.resourceId) return;
          const buyer = await this.deps.resolveBuyer.resolve(current.merchantId, buyerToken);
          if (!buyer) return;
          const verified = serviceBookingScopeFromVerifiedBuyer(embed, headers, buyer, buyerToken);
          if (verified.cartRef !== binding.cartRef) return;
          return Object.freeze({ ...verified, expiresAtUnix: Math.min(verified.expiresAtUnix, current.expiresAt) });
        } catch { return undefined; }
      };
      const reader = async (): Promise<ScopedServiceBookingReader | undefined> => {
        if (!await scope()) return;
        const run = async <T>(work: (current: ServiceBookingScope) => Promise<T>) => {
          const current = await scope(); if (!current) throw new Error("service_booking_authority_required");
          return work(current);
        };
        return {
          professionals: input => run(current => this.deps.booking.professionals(current, input)),
          dates: input => run(current => this.deps.booking.dates(current, input)),
          slots: input => run(current => this.deps.booking.slots(current, input)),
          select: input => run(current => this.deps.booking.select(current, input)),
          offerName: input => run(async current => {
            const product = await this.deps.prisma.product.findFirst({ where: { id: input.productId, merchantId: current.merchantId, type: "service",
              isActive: true, deletedAt: null, variants: { some: { id: input.variantId, isActive: true } } }, select: { name: true } });
            if (!product) throw new Error("professional_service_not_found"); return product.name;
          }),
        };
      };
      return createServiceBookingHandlers(claims.merchantId, reader, this.clock);
    };
  }
}
