import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  Logger,
  Optional,
  Post,
  Query,
  Req,
  Param,
  UnauthorizedException,
  ServiceUnavailableException,
  UseGuards
} from "@nestjs/common";
import type {
  ApplyOfferRequest,
  ApplyOfferResponse,
  ChatMessageRequest,
  ChatMessageReference,
  StartCheckoutRequest,
  TrackEventRequest,
  UpdateCartRequest
} from "@zyon/shared-types";
import { ApplyOfferUseCase } from "../../../checkout/application/use-cases/apply-offer.use-case.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../../checkout/application/use-cases/track-checkout-event.use-case.js";
import { SendChatMessageUseCase } from "../../../checkout/application/use-cases/send-chat-message.use-case.js";
import { ReconcileChatMessageUseCase } from "../../../checkout/application/use-cases/reconcile-chat-message.use-case.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { ConfirmCryptoPaymentUseCase } from "../../../payment/application/confirm-crypto-payment.use-case.js";
import { ConfirmStripePaymentUseCase } from "../../../payment/application/confirm-stripe-payment.use-case.js";
import { GetPaymentIntentStatusUseCase } from "../../../payment/application/get-payment-intent-status.use-case.js";
import { UpdateCartUseCase } from "../../../checkout/application/use-cases/update-cart.use-case.js";
import {
  CHECKOUT_REPOSITORY,
  type CheckoutRepository
} from "../../../checkout/domain/ports/checkout-repository.port.js";
import type { EmbedTokenClaims } from "../../domain/embed-token.service.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { RequireEmbedScope } from "./embed-scope.decorator.js";
import { UpdateEmbedCustomerUseCase } from "../../application/update-embed-customer.use-case.js";
import { embedCheckoutSessionId } from "../../domain/embed-checkout-session.js";
import { ResolveEmbedBuyerService } from "../../application/resolve-embed-buyer.service.js";
import { RateLimit } from "../../../../shared/http/rate-limit.guard.js";
import { buildExperienceFromSession } from "../../../checkout/application/services/checkout-experience.service.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { ReopenEmbedCheckoutUseCase } from "../../application/reopen-embed-checkout.use-case.js";

export type EmbedHttpRequest = {
  embedClaims?: EmbedTokenClaims;
  headers?: Record<string, string | string[] | undefined>;
};

@Injectable()
export class EmbedCheckoutGuardHelper {
  constructor(@Inject(CHECKOUT_REPOSITORY) private readonly checkout: CheckoutRepository) {}

  async assertSessionBelongsToEmbedMerchant(embed: EmbedTokenClaims, sessionId: string): Promise<void> {
    if (sessionId !== embedCheckoutSessionId(embed)) {
      throw new UnauthorizedException("embed_checkout_session_binding_mismatch");
    }
    // Retry once on transient DB connection failures (pg-pool timeout)
    let session: any;
    try {
      session = await this.checkout.getSession(embed.merchantId, sessionId);
    } catch {
      // Wait 500ms and retry once (connection pool recovery)
      await new Promise(r => setTimeout(r, 500));
      session = await this.checkout.getSession(embed.merchantId, sessionId);
    }
    if (!session) throw new UnauthorizedException("embed_unknown_checkout_session");
    if (session.merchantId !== embed.merchantId) {
      throw new UnauthorizedException("embed_merchant_mismatch_for_checkout_session");
    }
  }

  async assertBuyerRegisteredForPayment(merchantId: string, sessionId: string): Promise<void> {
    const session = await this.checkout.getSession(merchantId, sessionId);
    const customer = session?.customer;
    const cpf = customer?.cpf?.replace(/\D/g, "");
    if (!customer?.fullName?.trim() || !customer.email?.trim() || !customer.phone?.replace(/\D/g, "") || cpf?.length !== 11) {
      throw new BadRequestException("customer_registration_required");
    }
  }

  async loadSession(merchantId: string, sessionId: string) {
    return this.checkout.getSession(merchantId, sessionId);
  }

  async persistSession(session: import("@zyon/shared-types").CheckoutSession): Promise<void> {
    await this.checkout.saveSession(session);
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
    private readonly confirmStripePayment: ConfirmStripePaymentUseCase,
    private readonly getPaymentIntentStatus: GetPaymentIntentStatusUseCase,
    private readonly updateCart: UpdateCartUseCase,
    private readonly updateEmbedCustomer: UpdateEmbedCustomerUseCase,
    @Optional() private readonly resolveBuyer?: ResolveEmbedBuyerService,
    @Optional() private readonly reconcileChat?: ReconcileChatMessageUseCase,
    @Optional() private readonly reopenCheckout?: ReopenEmbedCheckoutUseCase,
  ) {}

  private readonly logger = new Logger(EmbedCheckoutController.name);

  @Post("checkout/edit")
  @RequireEmbedScope("payment:intents:create")
  async editCheckout(@Req() request: EmbedHttpRequest,
    @Body() body: { session_id: string; section: import("@zyon/shared-types").CheckoutEditSection }) {
    if (typeof body.session_id !== "string" || !["payment", "shipping", "address", "coupon"].includes(body.section)) {
      throw new BadRequestException("checkout_edit_invalid");
    }
    const embed = request.embedClaims!;
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    if (!this.reopenCheckout) throw new ServiceUnavailableException("checkout_edit_unavailable");
    return this.reopenCheckout.execute(embed.merchantId, body.session_id, body.section);
  }

  @Post("start")
  @RequireEmbedScope("checkout:start")
  async start(@Req() request: EmbedHttpRequest, @Body() body: StartCheckoutRequest & { buyer_access_token?: unknown }) {
    const embed = request.embedClaims!;
    const sessionId = embedCheckoutSessionId(embed);
    if (body.session_id !== undefined && body.session_id !== sessionId) {
      throw new UnauthorizedException("embed_checkout_session_binding_mismatch");
    }
    // A commerce cart may only enter the checkout through the signed token
    // claim. A top-level cart_ref is browser-controlled and must never become
    // an alternate binding path.
    const submittedRef = (body as { cart_ref?: unknown }).cart_ref;
    if (submittedRef !== undefined && submittedRef !== (embed.storefrontCartRef ?? embed.cartRef)) {
      throw new UnauthorizedException("embed_commerce_cart_must_be_token_bound");
    }
    if (body.cart?.commerceCartRef && body.cart.commerceCartRef !== embed.cartRef) {
      throw new UnauthorizedException("embed_commerce_cart_binding_mismatch");
    }
    if (body.buyer_access_token !== undefined && !this.resolveBuyer) {
      throw new UnauthorizedException("embed_buyer_authentication_unavailable");
    }
    const trustedBuyer = await this.resolveBuyer?.resolve(embed.merchantId, body.buyer_access_token);
    const recovered = embed.recoveredCheckoutSessionId ? await this.embedGuards.loadSession(embed.merchantId, sessionId) : undefined;
    if (embed.recoveredCheckoutSessionId && (!recovered || !trustedBuyer || recovered.globalUserId !== trustedBuyer.globalUserId)) {
      throw new UnauthorizedException("checkout_buyer_proof_required");
    }
    const { merchant_id: _discard, merchantId: _d2, cart_ref: _ref, buyer_access_token: _buyerToken, global_user_id: _buyerId, ...rest } = body as StartCheckoutRequest & {
      merchantId?: string;
      cart_ref?: unknown;
      buyer_access_token?: unknown;
      global_user_id?: unknown;
    };
    const result = await this.startCheckout.execute({
      ...(rest as Omit<StartCheckoutRequest, "merchant_id">),
      merchant_id: embed.merchantId,
      session_id: sessionId,
      cart: recovered?.cart ?? (embed.cartRef ? { ...body.cart, commerceCartRef: embed.cartRef } : body.cart),
    }, { storefrontCartRef: recovered ? (recovered.cart as { cart_ref?: string }).cart_ref : embed.storefrontCartRef, trustedBuyer, requireBuyerProof: true, refreshCart: !!recovered });
    const chatState = await this.reconcileChat?.readState(embed.merchantId, result.session_id);
    // start scope advertises capability only; reading history still requires chat scope.
    return { ...result, ...(chatState?.protocol === "durable_v2" ? { chat_protocol: "durable_v2" as const } : {}) };
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
  @RateLimit(120)
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

  @Post("chat/reconcile")
  @RateLimit(120)
  @RequireEmbedScope("checkout:chat")
  async reconcileMessage(@Req() request: EmbedHttpRequest, @Body() body: ChatMessageReference) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string") throw new BadRequestException("session_id_required");
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    if (!this.reconcileChat) throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_STORE_UNAVAILABLE" });
    return this.reconcileChat.execute({ merchant_id: embed.merchantId, session_id: body.session_id,
      conversation_id: body.conversation_id, message_id: body.message_id });
  }

  @Post("chat/display")
  @RateLimit(120)
  @RequireEmbedScope("checkout:chat")
  async chatDisplay(@Req() request: EmbedHttpRequest, @Body() body: import("@zyon/shared-types").ChatDisplayReport) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string") throw new BadRequestException("session_id_required");
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    if (!this.reconcileChat) throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_STORE_UNAVAILABLE" });
    return this.reconcileChat.recordDisplay(embed.merchantId, { session_id: body.session_id,
      conversation_id: body.conversation_id, display_ref: body.display_ref, definition: body.definition });
  }

  @Get("chat/state")
  @Header("Cache-Control", "no-store")
  @RateLimit(120)
  @RequireEmbedScope("checkout:chat")
  async chatState(@Req() request: EmbedHttpRequest, @Query("session_id") sessionId: string,
    @Query("message_id") messageId?: string) {
    const embed = request.embedClaims!;
    if (typeof sessionId !== "string") throw new BadRequestException("session_id_required");
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId);
    if (!this.reconcileChat) throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_STORE_UNAVAILABLE" });
    return this.reconcileChat.readState(embed.merchantId, sessionId, messageId);
  }

  @Get("chat/payment")
  @Header("Cache-Control", "no-store")
  @RateLimit(120)
  @RequireEmbedScope("payment:intents:create")
  async chatPayment(@Req() request: EmbedHttpRequest, @Query("session_id") sessionId: string,
    @Query("intent_id") intentId: string) {
    const embed = request.embedClaims!;
    if (typeof sessionId !== "string" || typeof intentId !== "string") throw new BadRequestException("session_and_intent_required");
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId);
    if (!this.reconcileChat) throw new ServiceUnavailableException({ code: "CHAT_MESSAGE_STORE_UNAVAILABLE" });
    return this.reconcileChat.readPayment(embed.merchantId, sessionId, intentId);
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

  @Post("cart")
  @RequireEmbedScope("checkout:track")
  async cart(@Req() request: EmbedHttpRequest, @Body() body: UpdateCartRequest) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string") {
      throw new BadRequestException("session_id_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    const { merchant_id: _m, ...rest } = body;
    return this.updateCart.execute({
      ...(rest as Omit<UpdateCartRequest, "merchant_id">),
      merchant_id: embed.merchantId
    });
  }

  @Post("customer/update")
  @RequireEmbedScope("checkout:track")
  async updateCustomer(
    @Req() request: EmbedHttpRequest,
    @Body()
    body: {
      session_id: string;
      customer: {
        fullName?: string;
        email?: string;
        cpf?: string;
        phone?: string;
      };
    }
  ) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string") {
      throw new BadRequestException("session_id_required");
    }
    if (!body.customer || typeof body.customer !== "object") {
      throw new BadRequestException("customer_required");
    }
    const c = body.customer;
    if (typeof c.cpf !== "string" || !c.cpf.trim()) {
      throw new BadRequestException("cpf_required");
    }
    if (typeof c.email !== "string" || !c.email.trim()) {
      throw new BadRequestException("email_required");
    }
    if (typeof c.fullName !== "string" || !c.fullName.trim()) {
      throw new BadRequestException("full_name_required");
    }
    if (typeof c.phone !== "string" || c.phone.replace(/\D/g, "").length < 10) {
      throw new BadRequestException("phone_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.updateEmbedCustomer.execute({
      merchantId: embed.merchantId,
      sessionId: body.session_id.trim(),
      customer: {
        fullName: c.fullName.trim(),
        email: c.email.trim(),
        cpf: c.cpf.trim(),
        phone: c.phone.trim()
      }
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
      confirmed_cart_fingerprint?: string;
      preferred_chain?: "polygon" | "base";
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
    await this.embedGuards.assertBuyerRegisteredForPayment(embed.merchantId, body.session_id);

    // Extract buyer's real IP for Asaas tokenization (PCI compliance)
    const forwarded = request.headers?.["x-forwarded-for"];
    const remoteIp = typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : Array.isArray(forwarded) ? forwarded[0]?.trim() : undefined;

    const intent = await this.createPaymentIntent.execute({
      merchant_id: embed.merchantId,
      session_id: body.session_id.trim(),
      idempotency_key: body.idempotency_key.trim(),
      method: body.method,
      confirmed_cart_fingerprint: body.confirmed_cart_fingerprint,
      accepted_offer_id:
        typeof body.accepted_offer_id === "string" ? body.accepted_offer_id.trim() || undefined : undefined,
      preferred_chain:
        body.preferred_chain === "polygon" || body.preferred_chain === "base"
          ? body.preferred_chain
          : undefined,
      credit_card: body.credit_card,
      remote_ip: remoteIp
    });
    const session = await this.embedGuards.loadSession(embed.merchantId, body.session_id.trim());
    const breakdown = intent.amountBreakdown;
    // Render the same finalized financial snapshot that the provider charged.
    if (!session || !breakdown || breakdown.cartFingerprint !== paymentCartFingerprint(session)) return intent;
    const experience = buildExperienceFromSession(session, { serviceFee: breakdown.platformFeeCents / 100 });
    return { ...intent, experience: {
      items: experience.items, shipping: experience.shipping,
      commercial_nudge: experience.commercial_nudge, applied_benefits: experience.applied_benefits,
      totals: experience.totals,
    } };
  }

  @Post("payment/intents/:intentId/crypto/confirm")
  @RequireEmbedScope("payment:intents:confirm")
  async confirmCryptoFromEmbed(
    @Req() request: EmbedHttpRequest,
    @Param("intentId") intentId: string,
    @Body()
    body: {
      session_id: string;
      tx_hash: string;
      tx_hashes?: string[];
      wallet_address: string;
    }
  ) {
    const embed = request.embedClaims!;
    if (
      typeof body.session_id !== "string" ||
      typeof body.tx_hash !== "string" ||
      typeof body.wallet_address !== "string" ||
      (body.tx_hashes !== undefined && (!Array.isArray(body.tx_hashes) || body.tx_hashes.some((hash) => typeof hash !== "string")))
    ) {
      throw new BadRequestException("crypto_confirm_fields_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    return this.confirmCryptoPayment.execute({
      merchant_id: embed.merchantId,
      session_id: body.session_id.trim(),
      intent_id: intentId.trim(),
      tx_hash: body.tx_hash.trim(),
      tx_hashes: body.tx_hashes?.map((hash) => hash.trim()),
      wallet_address: body.wallet_address.trim()
    });
  }

  @Post("payment/intents/:intentId/stripe/confirm")
  @RequireEmbedScope("payment:intents:confirm")
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

  @Get("payment/intents/:intentId/status")
  @RequireEmbedScope("payment:intents:read")
  async paymentStatusFromEmbed(
    @Req() request: EmbedHttpRequest,
    @Param("intentId") intentId: string,
    @Query("session_id") sessionId: string
  ) {
    const embed = request.embedClaims!;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new BadRequestException("session_id_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, sessionId.trim());
    return this.getPaymentIntentStatus.execute({
      merchant_id: embed.merchantId,
      session_id: sessionId.trim(),
      intent_id: intentId.trim()
    });
  }

  // NOTE: shipping/select is handled by EmbedShippingController at
  // @Controller("embed/shipping") using carrier_key + SelectShippingMethodUseCase.
  // The legacy option_index handler was removed to eliminate the route conflict.
}
