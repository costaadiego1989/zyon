import { Body, ConflictException, Controller, ForbiddenException, Inject, Param, Post, Req, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { RealtimeCapabilityService, isHttpOrigin } from "../../../../shared/auth/realtime-capability.js";
import { STOREFRONT_CROSS_SELL_CART, type StorefrontCrossSellCartPort } from "../../domain/ports/storefront-cross-sell-cart.port.js";
import { crossSellStorefrontAcceptanceSchema, crossSellStorefrontAcknowledgementSchema, crossSellStorefrontQuoteRequestSchema,
  crossSellStorefrontQuoteSchema } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { StorefrontCartSnapshotConflictError } from "../../domain/errors/storefront-cart-snapshot-conflict.error.js";
import { storefrontOptionLineIdentity } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";

type Request = { headers?: { authorization?: string; origin?: string;
  "x-trusted-storefront-origin"?: string | string[]; "x-internal-service-token"?: string | string[] } };
const first = (header: string | string[] | undefined) => (typeof header === "string" ? header : header?.[0])?.trim() || undefined;
const refused = () => new UnprocessableEntityException({ code: "cross_sell_quote_review_required",
  message: "Não foi possível confirmar esta oferta. Confira o carrinho antes de continuar." });

/** Dedicated buyer commands, never a read-ui-action or model tool grant. */
@Controller("storefront/:merchantId/cart/:cartId/cross-sell")
export class StorefrontCrossSellController {
  constructor(@Inject(RealtimeCapabilityService) private readonly capabilities: RealtimeCapabilityService,
    @Inject(STOREFRONT_CROSS_SELL_CART) private readonly cart: StorefrontCrossSellCartPort) {}

  private scope(merchantId: string, cartId: string, request: Request) {
    const authorization = request.headers?.authorization;
    const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
    const internal = first(request.headers?.["x-internal-service-token"]);
    const forwarded = first(request.headers?.["x-trusted-storefront-origin"]);
    const origin = process.env.INTERNAL_SERVICE_TOKEN && internal === process.env.INTERNAL_SERVICE_TOKEN && isHttpOrigin(forwarded)
      ? forwarded : request.headers?.origin;
    let claims;
    try { claims = this.capabilities.verify(token, "storefront-conversation", origin); }
    catch { throw new UnauthorizedException("invalid_conversation_token"); }
    if (claims.merchantId !== merchantId || claims.resourceId !== cartId) throw new ForbiddenException("conversation_access_denied");
    return { merchantId: claims.merchantId, cartId: claims.resourceId };
  }

  @Post("quote")
  async quote(@Param("merchantId") merchantId: string, @Param("cartId") cartId: string,
    @Body() body: unknown, @Req() request: Request) {
    const scope = this.scope(merchantId, cartId, request);
    const input = crossSellStorefrontQuoteRequestSchema.safeParse(body);
    if (!input.success) throw refused();
    const output = crossSellStorefrontQuoteSchema.safeParse(await this.cart.quote(scope, input.data));
    if (!output.success || output.data.merchantId !== scope.merchantId || output.data.cartId !== scope.cartId
      || output.data.variantId !== input.data.variantId || output.data.promotionId !== input.data.promotionId
      || output.data.quantity !== input.data.quantity
      || storefrontOptionLineIdentity(output.data) !== storefrontOptionLineIdentity(input.data)) throw refused();
    return output.data;
  }

  @Post("accept")
  async accept(@Param("merchantId") merchantId: string, @Param("cartId") cartId: string,
    @Body() body: unknown, @Req() request: Request) {
    const scope = this.scope(merchantId, cartId, request);
    const input = crossSellStorefrontAcceptanceSchema.safeParse(body);
    if (!input.success || input.data.expectedQuote.merchantId !== scope.merchantId
      || input.data.expectedQuote.cartId !== scope.cartId) throw refused();
    let result;
    try { result = await this.cart.accept(scope, input.data); }
    catch (error) {
      if (error instanceof StorefrontCartSnapshotConflictError) {
        throw new ConflictException({ code: error.code, message: "O carrinho mudou. Confira os itens antes de continuar." });
      }
      throw error;
    }
    const output = crossSellStorefrontAcknowledgementSchema.safeParse(result);
    if (!output.success || output.data.merchantId !== scope.merchantId || output.data.cartId !== scope.cartId) throw refused();
    return output.data;
  }
}
