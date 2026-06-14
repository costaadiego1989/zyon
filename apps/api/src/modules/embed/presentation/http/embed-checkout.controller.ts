import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Injectable,
  Post,
  Req,
  Param,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import type {
  ApplyOfferRequest,
  ApplyOfferResponse,
  ChatMessageRequest,
  StartCheckoutRequest,
  TrackEventRequest
} from "@aacp/shared-types";
import { ApplyOfferUseCase } from "../../../checkout/application/use-cases/apply-offer.use-case.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../../checkout/application/use-cases/track-checkout-event.use-case.js";
import { SendChatMessageUseCase } from "../../../checkout/application/use-cases/send-chat-message.use-case.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { ConfirmCryptoPaymentUseCase } from "../../../payment/application/confirm-crypto-payment.use-case.js";
import { ConfirmStripePaymentUseCase } from "../../../payment/application/confirm-stripe-payment.use-case.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../../checkout/domain/ports/checkout-repository.port.js";
import type { EmbedTokenClaims } from "../../domain/embed-token.service.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { RequireEmbedScope } from "./embed-scope.decorator.js";

export type EmbedHttpRequest = {
  embedClaims?: EmbedTokenClaims;
  headers?: Record<string, string | string[] | undefined>;
};

@Injectable()
export class EmbedCheckoutGuardHelper {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly checkout: CheckoutRepository) {}

  async assertSessionBelongsToEmbedMerchant(embed: EmbedTokenClaims, sessionId: string): Promise<void> {
    const session = await this.checkout.getSession(embed.merchantId, sessionId);
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    if (session.merchantId !== embed.merchantId) {
      throw new UnauthorizedException("embed_merchant_mismatch_for_checkout_session");
    }
  }
}

@UseGuards(EmbedAuthGuard)
@Controller("embed")
export class EmbedCheckoutController {
  constructor(
    private readonly startCheckout: StartCheckoutUseCase,
    private readonly trackEvent: TrackCheckoutEventUseCase,
    private readonly sendChat: SendChatMessageUseCase,
    private readonly embedGuards: EmbedCheckoutGuardHelper,
    private readonly applyOfferUseCase: ApplyOfferUseCase,
    private readonly createPaymentIntent: CreatePaymentIntentUseCase,
    private readonly confirmCryptoPayment: ConfirmCryptoPaymentUseCase,
    private readonly confirmStripePayment: ConfirmStripePaymentUseCase
  ) {}

  @Post("start")
  @RequireEmbedScope("checkout:start")
  async start(@Req() request: EmbedHttpRequest, @Body() body: StartCheckoutRequest) {
    const embed = request.embedClaims!;
    const { merchant_id: _discard, merchantId: _d2, ...rest } = body as StartCheckoutRequest & {
      merchantId?: string;
    };
    return this.startCheckout.execute({
      ...(rest as Omit<StartCheckoutRequest, "merchant_id">),
      merchant_id: embed.merchantId
    });
  }

  @Post("track")
  @RequireEmbedScope("checkout:track")
  async track(@Req() request: EmbedHttpRequest, @Body() body: TrackEventRequest) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string") {
      throw new BadRequestException("session_id_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    const { merchant_id: _m, ...rest } = body;
    return this.trackEvent.execute({
      ...(rest as Omit<TrackEventRequest, "merchant_id">),
      merchant_id: embed.merchantId
    });
  }

  @Post("chat")
  @RequireEmbedScope("checkout:chat")
  async chat(@Req() request: EmbedHttpRequest, @Body() body: ChatMessageRequest) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string") {
      throw new BadRequestException("session_id_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    const { merchant_id: _m, ...rest } = body;
    return this.sendChat.execute({
      ...(rest as Omit<ChatMessageRequest, "merchant_id">),
      merchant_id: embed.merchantId
    });
  }

  @Post("offers/apply")
  @RequireEmbedScope("offers:apply")
  async applyOffer(@Req() request: EmbedHttpRequest, @Body() body: ApplyOfferRequest): Promise<ApplyOfferResponse> {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string" || typeof body.offer_id !== "string") {
      throw new BadRequestException("session_id_and_offer_id_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    const { merchant_id: _m, ...rest } = body;
    return this.applyOfferUseCase.execute({
      ...(rest as Omit<ApplyOfferRequest, "merchant_id">),
      merchant_id: embed.merchantId
    });
  }

  @Post("payment/intents")
  @RequireEmbedScope("payment:intents:create")
  async intentFromEmbed(
    @Req() request: EmbedHttpRequest,
    @Body()
    body: {
      session_id: string;
      idempotency_key: string;
      method?: "pix" | "card" | "boleto" | "crypto";
      accepted_offer_id?: string;
      credit_card?: {
        holderName: string;
        number: string;
        expiryMonth: string;
        expiryYear: string;
        ccv: string;
      };
    }
  ) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string" || typeof body.idempotency_key !== "string") {
      throw new BadRequestException("session_and_idempotency_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);

    // Extract buyer's real IP for Asaas tokenization (PCI compliance)
    const forwarded = request.headers?.["x-forwarded-for"];
    const remoteIp = typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : Array.isArray(forwarded) ? forwarded[0]?.trim() : undefined;

    return this.createPaymentIntent.execute({
      merchant_id: embed.merchantId,
      session_id: body.session_id.trim(),
      idempotency_key: body.idempotency_key.trim(),
      method: body.method,
      accepted_offer_id:
        typeof body.accepted_offer_id === "string" ? body.accepted_offer_id.trim() || undefined : undefined,
      credit_card: body.credit_card,
      remote_ip: remoteIp
    });
  }

  @Post("payment/intents/:intentId/crypto/confirm")
  async confirmCryptoFromEmbed(
    @Req() request: EmbedHttpRequest,
    @Param("intentId") intentId: string,
    @Body()
    body: {
      session_id: string;
      tx_hash: string;
      wallet_address: string;
    }
  ) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string" || typeof body.tx_hash !== "string" || typeof body.wallet_address !== "string") {
      throw new BadRequestException("crypto_confirm_fields_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.confirmCryptoPayment.execute({
      merchant_id: embed.merchantId,
      session_id: body.session_id.trim(),
      intent_id: intentId.trim(),
      tx_hash: body.tx_hash.trim(),
      wallet_address: body.wallet_address.trim()
    });
  }

  @Post("payment/intents/:intentId/stripe/confirm")
  async confirmStripeFromEmbed(
    @Req() request: EmbedHttpRequest,
    @Param("intentId") intentId: string,
    @Body() body: { session_id: string }
  ) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string") {
      throw new BadRequestException("stripe_confirm_fields_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.confirmStripePayment.execute({
      merchant_id: embed.merchantId,
      session_id: body.session_id.trim(),
      intent_id: intentId.trim()
    });
  }
}
