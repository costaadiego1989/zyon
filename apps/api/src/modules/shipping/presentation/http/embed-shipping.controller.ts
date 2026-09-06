import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Optional,
  Post,
  Req,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import type {
  ShippingQuoteRequest,
  ShippingSelectRequest
} from "@zyon/shared-types";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import type { EmbedTokenClaims } from "../../../embed/domain/embed-token.service.js";
import { embedCheckoutSessionId } from "../../../embed/domain/embed-checkout-session.js";
import { RequireEmbedScope } from "../../../embed/presentation/http/embed-scope.decorator.js";
import { QuoteShippingUseCase } from "../../application/use-cases/quote-shipping.use-case.js";
import { SelectShippingMethodUseCase } from "../../application/use-cases/select-shipping-method.use-case.js";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository
} from "../../../merchant/domain/ports/merchant-rules.repository.port.js";
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepository
} from "../../../checkout/domain/ports/checkout-session.repository.port.js";

type EmbedHttpRequest = { embedClaims?: EmbedTokenClaims };

@UseGuards(EmbedAuthGuard)
@Controller("embed/shipping")
export class EmbedShippingController {
  constructor(
    private readonly quoteShipping: QuoteShippingUseCase,
    private readonly selectMethod: SelectShippingMethodUseCase,
    @Optional() @Inject(MERCHANT_RULES_REPOSITORY) private readonly merchantRulesRepo?: MerchantRulesRepository,
    @Optional() @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions?: CheckoutSessionRepository
  ) {}

  @Post("quote")
  @RequireEmbedScope("checkout:track")
  async quote(@Req() request: EmbedHttpRequest, @Body() body: ShippingQuoteRequest) {
    const merchantId = this.requireMerchantId(request);
    const sessionId = requireString(body.session_id, "session_id_required");
    const destinationZip = requireString(body.destination_zip, "destination_zip_required");

    const session = await this.loadOwnedSession(request.embedClaims!, sessionId);
    const rules = await this.merchantRulesRepo?.getRules(merchantId);

    return this.quoteShipping.execute({
      session_id: sessionId,
      merchant_id: merchantId,
      destination_zip: destinationZip,
      cart_total: session.cart.total,
      // P0 fix: free_shipping_threshold is intentionally NOT forwarded from the
      // request body. The use-case derives it from merchant rules via its own
      // MERCHANT_RULES_REPOSITORY injection, preventing client-side bypass of
      // the shipping-engine subsidy invariant.
      origin_zip: rules?.originZip ?? "",
      packages: session.cart.items.map((item) => {
        const weightKg = item.weightGrams != null ? item.weightGrams / 1000 : item.weight_kg;
        const dimensions = [weightKg, item.height_cm, item.width_cm, item.length_cm];
        if (dimensions.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
          throw new BadRequestException("checkout_product_shipping_dimensions_required");
        }
        return { weightKg: weightKg!, heightCm: item.height_cm!, widthCm: item.width_cm!, lengthCm: item.length_cm!, quantity: item.quantity };
      }),
      items: session.cart.items.map((item) => ({ sku: item.sku, quantity: item.quantity }))
    });
  }

  @Post("select")
  @RequireEmbedScope("checkout:track")
  async select(@Req() request: EmbedHttpRequest, @Body() body: ShippingSelectRequest) {
    const merchantId = this.requireMerchantId(request);
    const sessionId = requireString(body.session_id, "session_id_required");
    const carrierKey = requireString(body.carrier_key, "carrier_key_required");

    await this.loadOwnedSession(request.embedClaims!, sessionId);

    return this.selectMethod.execute({
      session_id: sessionId,
      merchant_id: merchantId,
      carrier_key: carrierKey
    });
  }

  private requireMerchantId(request: EmbedHttpRequest): string {
    const merchantId = request.embedClaims?.merchantId;
    if (!merchantId) throw new UnauthorizedException("missing_embed_session_token");
    return merchantId;
  }

  private async loadOwnedSession(embed: EmbedTokenClaims, sessionId: string) {
    if (sessionId !== embedCheckoutSessionId(embed)) {
      throw new UnauthorizedException("embed_checkout_session_binding_mismatch");
    }
    if (!this.sessions) throw new UnauthorizedException("embed_checkout_session_repository_required");
    const merchantId = embed.merchantId;
    const session = await this.sessions.getSession(merchantId, sessionId);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    if (session.merchantId !== merchantId) {
      throw new UnauthorizedException("embed_merchant_mismatch_for_checkout_session");
    }
    return session;
  }
}

function requireString(value: unknown, error: string): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(error);
  return value.trim();
}
