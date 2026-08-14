import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Post,
  Query,
  Req,
  Param,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import type {
  ApplyOfferRequest,
  ApplyOfferResponse,
  ChatMessageRequest,
  CustomerHints,
  StartCheckoutRequest,
  TrackEventRequest,
  UpdateCartRequest
} from "@zyon/shared-types";
import { ApplyOfferUseCase } from "../../../checkout/application/use-cases/apply-offer.use-case.js";
import { StartCheckoutUseCase } from "../../../checkout/application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../../checkout/application/use-cases/track-checkout-event.use-case.js";
import { SendChatMessageUseCase } from "../../../checkout/application/use-cases/send-chat-message.use-case.js";
import { CreatePaymentIntentUseCase } from "../../../payment/application/create-payment-intent.use-case.js";
import { ConfirmCryptoPaymentUseCase } from "../../../payment/application/confirm-crypto-payment.use-case.js";
import { ConfirmStripePaymentUseCase } from "../../../payment/application/confirm-stripe-payment.use-case.js";
import { GetPaymentIntentStatusUseCase } from "../../../payment/application/get-payment-intent-status.use-case.js";
import { TenantWebhookPublisher } from "../../../integrations/application/integrations.use-cases.js";
import { WebhookDeliveryDispatcher } from "../../../integrations/application/webhook-delivery-dispatcher.service.js";
import { UpdateCartUseCase } from "../../../checkout/application/use-cases/update-cart.use-case.js";
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
    private readonly webhookPublisher: TenantWebhookPublisher,
    private readonly webhookDispatcher: WebhookDeliveryDispatcher
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
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    const current = await this.embedGuards.loadSession(
      embed.merchantId,
      body.session_id.trim()
    );
    const previousCustomer = current?.customer ?? {};
    const updatedSession = {
      ...current!,
      customer: {
        ...(current?.customer ?? {}),
        fullName: c.fullName.trim(),
        email: c.email.trim(),
        cpf: c.cpf.replace(/\D+/g, "").trim(),
        phone: typeof c.phone === "string" ? c.phone.trim() : undefined
      },
      updatedAt: new Date().toISOString()
    };
    await this.embedGuards.persistSession(updatedSession);

    void this.emitFunnelEvents(
      embed.merchantId,
      body.session_id,
      previousCustomer,
      updatedSession.customer,
      updatedSession.globalUserId
    );

    return { ok: true };
  }

  private async emitFunnelEvents(
    merchantId: string,
    sessionId: string,
    previous: Partial<CustomerHints>,
    current: Partial<CustomerHints>,
    globalUserId: string
  ): Promise<void> {
    const now = new Date().toISOString();

    const phoneIsNew = !previous.phone && !!current.phone;
    if (phoneIsNew) {
      const deliveries = await this.webhookPublisher.publish({
        merchantId,
        eventType: "customer.phone_collected",
        occurredAt: now,
        data: {
          session_id: sessionId,
          global_user_id: globalUserId,
          phone_masked: this.maskPhone(current.phone!)
        }
      });
      await this.dispatchDeliveries(deliveries);
    }

    const fields: Array<{ key: keyof CustomerHints; label: string }> = [
      { key: "phone", label: "phone" },
      { key: "email", label: "email" },
      { key: "fullName", label: "name" },
      { key: "cpf", label: "cpf" }
    ];
    for (const field of fields) {
      const prev = previous[field.key];
      const curr = current[field.key];
      if (!prev && curr) {
        const deliveries = await this.webhookPublisher.publish({
          merchantId,
          eventType: "funnel.step_completed",
          occurredAt: now,
          data: {
            session_id: sessionId,
            global_user_id: globalUserId,
            field: field.label,
            value_masked: this.maskValue(field.label, String(curr))
          }
        });
        await this.dispatchDeliveries(deliveries);
      }
    }

    const allFilled = !!current.phone && !!current.email && !!current.fullName && !!current.cpf;
    const wasMissing = !previous.phone || !previous.email || !previous.fullName || !previous.cpf;
    if (allFilled && wasMissing) {
      const deliveries = await this.webhookPublisher.publish({
        merchantId,
        eventType: "customer.registered",
        occurredAt: now,
        data: {
          session_id: sessionId,
          global_user_id: globalUserId,
          data_controller: "merchant",
          customer: {
            phone: current.phone,
            email: current.email,
            full_name: current.fullName,
            cpf: this.maskCpf(String(current.cpf)),
            address: current.address ?? null
          }
        }
      });
      await this.dispatchDeliveries(deliveries);
    }
  }

  private async dispatchDeliveries(
    deliveries: Awaited<ReturnType<TenantWebhookPublisher["publish"]>>
  ): Promise<void> {
    for (const delivery of deliveries) {
      try {
        await this.webhookDispatcher.dispatchDelivery(delivery);
      } catch {
        // delivery remains queued for background retry
      }
    }
  }

  private maskPhone(phone: string): string {
    if (phone.length <= 4) return "****";
    return phone.slice(0, 2) + "*".repeat(phone.length - 4) + phone.slice(-2);
  }

  private maskCpf(cpf: string): string {
    const digits = cpf.replace(/\D/g, "");
    if (digits.length < 11) return "***.***.***-**";
    return `${digits.slice(0, 3)}.***.***.${digits.slice(-2)}`;
  }

  private maskValue(field: string, value: string): string {
    if (field === "phone") return this.maskPhone(value);
    if (field === "cpf") return this.maskCpf(value);
    if (field === "email") {
      const [local, domain] = value.split("@");
      if (!local || !domain) return "***@***";
      return local.slice(0, 2) + "***@" + domain;
    }
    if (value.length <= 3) return "***";
    return value.slice(0, 3) + "***";
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
  @RequireEmbedScope("payment:intents:confirm")
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

  @Post("shipping/select")
  @RequireEmbedScope("checkout:track")
  async selectShipping(
    @Req() request: EmbedHttpRequest,
    @Body() body: { session_id: string; option_index: number }
  ) {
    const embed = request.embedClaims!;
    if (typeof body.session_id !== "string" || !body.session_id.trim()) {
      throw new BadRequestException("session_id_required");
    }
    if (typeof body.option_index !== "number" || body.option_index < 0) {
      throw new BadRequestException("option_index_required");
    }
    await this.embedGuards.assertSessionBelongsToEmbedMerchant(embed, body.session_id);
    const session = await this.embedGuards.loadSession(embed.merchantId, body.session_id.trim());
    if (!session) throw new BadRequestException("session_not_found");
    if (!session.shippingOptions?.length) {
      throw new BadRequestException("no_shipping_options_available");
    }
    if (body.option_index >= session.shippingOptions.length) {
      throw new BadRequestException("option_index_out_of_range");
    }
    const selected = session.shippingOptions[body.option_index];
    const updated = {
      ...session,
      shipping: selected,
      updatedAt: new Date().toISOString()
    };
    await this.embedGuards.persistSession(updated);
    return { ok: true, shipping: selected };
  }
}
