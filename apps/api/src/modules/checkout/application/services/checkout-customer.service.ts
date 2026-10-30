import { ConflictException, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { customerCorrection, type CustomerCorrection } from "../../domain/services/customer-correction.js";
import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import type { ChatExchangeClaim } from "../../domain/ports/checkout-session.repository.port.js";
import { CheckoutEmailOtpVerificationError } from "../../domain/services/checkout-email-otp-verification.js";
import { BrevoBuyerEmailNotifier } from "../../infrastructure/brevo-buyer-email.notifier.js";
import {
  extractCep,
  extractCpf,
  extractEmail,
  extractOtp,
  extractName,
  extractStandaloneName,
  extractPhone,
  isBrazilianMobilePhone,
} from "../../domain/services/customer-extraction.service.js";
import { OtpDeliveryError, OtpService, OtpValidationError } from "./otp.service.js";
import { BuyerRecognitionService } from "./buyer-recognition.service.js";
import { BuyerAccountPersistenceService } from "./buyer-account-persistence.service.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";
import { WHATSAPP_TEMPLATE_SENDER, type WhatsAppTemplateSenderPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";
import { commitCheckoutMutation } from "./commit-checkout-mutation.js";
import { CheckoutSavedAddressService } from "./checkout-saved-address.service.js";
import type { TrustedCheckoutBuyer } from "./trusted-checkout-buyer.js";

// Re-export for backwards compatibility
export { OtpValidationError } from "./otp.service.js";

/**
 * Orchestrator service for customer input processing.
 * Delegates to focused services:
 * - OtpService: OTP generation, validation, resend
 * - BuyerRecognitionService: find returning buyer, merge profile, resolve global_user_id
 * - BuyerAccountPersistenceService: ensure account exists, update profile
 *
 * Reduced from 460 LOC to ~150 LOC orchestrator.
 */
@Injectable()
export class CheckoutCustomerService {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly repository: CheckoutSessionRepository,
    @Optional() private readonly buyerEmailNotifier?: BrevoBuyerEmailNotifier,
    private readonly otpService?: OtpService,
    private readonly recognitionService?: BuyerRecognitionService,
    private readonly persistenceService?: BuyerAccountPersistenceService,
    @Optional() @Inject(EMAIL_SENDER_PORT) private readonly emailSender?: EmailSenderPort,
    @Optional() @Inject(WHATSAPP_TEMPLATE_REPOSITORY) _templates?: WhatsAppTemplateRepositoryPort,
    @Optional() @Inject(WHATSAPP_TEMPLATE_SENDER) _whatsappTemplates?: WhatsAppTemplateSenderPort,
    @Optional() private readonly savedAddresses?: CheckoutSavedAddressService,
  ) {}

  /** Starts an identity challenge without treating an internal command as buyer data. */
  async beginEmailVerification(session: CheckoutSession, merchantName?: string): Promise<CheckoutSession> {
    const email = session.customer?.email?.trim().toLowerCase();
    if (!email || !this.otpService) throw new OtpDeliveryError();
    if (session.customer?.email_verified) return session;
    if (session.customer?.otp_code && Date.parse(session.customer.otp_expires_at ?? "") > Date.now()) return session;
    const patch = this.otpService.processEmailOtp("Iniciar cadastro", { ...session.customer, otp_code: undefined }, email, false);
    if (!patch?.otp_code) throw new OtpDeliveryError();
    await this.deliverEmailOtp({ session, email, code: patch.otp_code, merchantName });
    return commitCheckoutMutation(this.repository, { expected: session, next: this.mergeCustomers(structuredClone(session), patch) });
  }

  async processCustomerInput(
    session: CheckoutSession,
    userMessage: string,
    lastAgentTurn: string | undefined,
    merchantName: string | undefined,
    chatClaim?: ChatExchangeClaim,
  ): Promise<CheckoutSession> {
    session = structuredClone(session);
    const patch = this.buildCustomerPatch(userMessage, session.customer, lastAgentTurn);
    if (!patch) return session;

    // A real normal acceptance cannot be reassigned by the generic two-commit
    // verified-flag/recognition path. The dedicated command consumes the actual
    // challenge and writes the canonical identity proof in the same transaction.
    if (patch.email_verified && session.cart.items.some(item => item.crossSellIntent !== undefined)) {
      const code = extractOtp(userMessage);
      if (!this.repository.verifyEmailOtpAndRecognize || !code || session.persistenceVersion === undefined)
        throw new OtpValidationError("Não foi possível confirmar a identidade agora. Revise o checkout antes de continuar.");
      let verified: CheckoutSession | undefined;
      try {
        verified = await this.repository.verifyEmailOtpAndRecognize({ merchantId: session.merchantId, sessionId: session.sessionId },
          { expectedVersion: session.persistenceVersion, code }, chatClaim);
      } catch (error) {
        if (error instanceof CheckoutEmailOtpVerificationError) throw new OtpValidationError(error.reason === "expired"
          ? "Esse código de confirmação expirou. Peça para reenviar o código e use o novo código para continuar."
          : "Código de verificação inválido. Por favor, confira o código enviado para o seu e-mail e tente novamente.");
        if (error instanceof Error && ["checkout_buyer_identity_review_required", "cross_sell_quote_review_required"].includes(error.message))
          throw new OtpValidationError("A identidade e os benefícios deste checkout precisam de revisão antes de continuar.");
        throw error;
      }
      if (verified) return this.recognizeAndPersistVerifiedBuyer(verified, verified.globalUserId);
    }

    const hadEmailAlready = Boolean(session.customer?.email?.trim());
    let working = this.mergeCustomers(session, patch);

    if (patch.otp_code) {
      await this.deliverEmailOtp({
        session,
        email: patch.email ?? session.customer?.email,
        code: patch.otp_code,
        merchantName,
      });
    }

    working = await commitCheckoutMutation(this.repository, { expected: session, next: working });

    if (patch.email && !hadEmailAlready && this.buyerEmailNotifier) {
      const merged = this.mergeHints(session.customer, patch);
      const buyerFirstHint = merged.fullName?.trim().split(/\s+/).filter(Boolean)[0];
      this.buyerEmailNotifier.notifyCaptured({
        buyerEmail: patch.email.toLowerCase(),
        merchantId: session.merchantId,
        sessionId: session.sessionId,
        merchantName,
        buyerFirstNameHint: buyerFirstHint
      });
    }

    if (patch.email_verified) {
      working = await this.recognizeAndPersistVerifiedBuyer(working);
      await this.persistenceService?.ensureBuyerAccountPersisted(working, true);
    }

    if (this.persistenceService?.isRegistrationComplete(working.customer)) {
      await this.persistenceService.ensureBuyerAccountPersisted(working);
    }

    return working;
  }

  async hydrateReturningBuyerFromEmailHint(session: CheckoutSession): Promise<CheckoutSession> {
    // An email hint (including an existing account's email) is not proof of possession.
    // Recognition is only performed after this session's OTP has been validated.
    if (!session.customer?.email_verified) return session;
    if (this.repository.readVerifiedNormalBuyerIdentity) {
      if (session.persistenceVersion === undefined) throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
      const pinned = await this.repository.readVerifiedNormalBuyerIdentity({ merchantId: session.merchantId, sessionId: session.sessionId },
        { expectedVersion: session.persistenceVersion, expectedBuyerId: session.globalUserId });
      if (pinned !== undefined) return this.recognizeAndPersistVerifiedBuyer(session, pinned);
    }
    return this.recognizeAndPersistVerifiedBuyer(session);
  }

  /** Read-only preparation for an independently authenticated checkout start.
   * The candidate may not exist in storage yet. Recognition cannot reassign the
   * signed identity, and no candidate is committed through a generic mutation. */
  async prepareTrustedBuyerForCheckout(session: CheckoutSession, buyer: TrustedCheckoutBuyer): Promise<CheckoutSession> {
    this.assertTrustedBuyer(session, buyer);
    const candidate = structuredClone(session);
    if (!this.recognitionService) return candidate;
    const recognized = await this.recognitionService.recognizeVerifiedBuyer(candidate, (s, patch) => this.mergeCustomers(s, patch), buyer.globalUserId);
    if (recognized.globalUserId !== undefined && recognized.globalUserId !== buyer.globalUserId) {
      throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
    }
    this.assertTrustedBuyer(recognized.session, buyer);
    return structuredClone(recognized.session);
  }

  /** Called only after the canonical create winner was authenticated and saved.
   * Account persistence rechecks the account's identity; this is not a SQL lease. */
  async persistTrustedBuyerProfile(session: CheckoutSession, buyer: TrustedCheckoutBuyer): Promise<void> {
    this.assertTrustedBuyer(session, buyer);
    await this.persistenceService?.ensureBuyerAccountPersisted(session, false, buyer.globalUserId);
  }

  private assertTrustedBuyer(session: CheckoutSession, buyer: TrustedCheckoutBuyer): void {
    if (!buyer.globalUserId || session.globalUserId !== buyer.globalUserId || buyer.customer.email_verified !== true ||
      session.customer?.email_verified !== true || !buyer.customer.email.trim() ||
      session.customer.email?.trim().toLowerCase() !== buyer.customer.email.trim().toLowerCase()) {
      throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
    }
  }

  async correctCustomerInput(session: CheckoutSession, text: string, lastAgentTurn?: string, merchantName?: string,
    chatClaim?: ChatExchangeClaim): Promise<(CustomerCorrection & { session: CheckoutSession; message?: string; needsInput?: boolean; blocked?: boolean }) | null> {
    session = structuredClone(session);
    const savedAddress = await this.savedAddresses?.resolve(session, text);
    if (savedAddress?.message) {
      const working = await commitCheckoutMutation(this.repository, { expected: session, next: savedAddress.session });
      return { field: "zip", question: "", session: working, message: savedAddress.message };
    }
    if (savedAddress) {
      session = await commitCheckoutMutation(this.repository, { expected: session, next: savedAddress.session });
      text = "Alterar endereço";
    }
    const correction = customerCorrection(session, text, lastAgentTurn);
    if (!correction) return null;
    if (correction.cancelled) return { ...correction, session };
    if (session.paymentMethod) {
      return { ...correction, session, message: "O pagamento já foi iniciado. Volte ao checkout antes de alterar os dados do pedido.", blocked: true };
    }
    if (!correction.patch) return { ...correction, session, message: correction.question, needsInput: true };
    const previous = session.customer ?? {};
    let working: CheckoutSession = { ...session, customer: { ...previous, ...correction.patch }, updatedAt: new Date().toISOString() };
    if (correction.field === "email" && correction.patch.email !== previous.email?.toLowerCase()) {
      if (!previous.email_verified && !previous.recognized_buyer && !previous.isReturning
        && !session.cart.items.some(item => item.crossSellIntent !== undefined)) {
        working.customer = { ...working.customer, email_verified: false, otp_code: "", otp_expires_at: "" };
        working = await commitCheckoutMutation(this.repository, { expected: session, next: working });
        return { ...correction, session: working, message: "E-mail de contato atualizado. Vamos continuar sua compra." };
      }
      if (session.cart.items.some(item => item.crossSellIntent !== undefined)) {
        if (!this.repository.detachNormalBuyerEmail || session.persistenceVersion === undefined) return { ...correction, session,
          blocked: true, message: "A identidade e os benefícios deste checkout precisam de revisão antes de corrigir o e-mail." };
        let detached: CheckoutSession | undefined;
        try {
          detached = await this.repository.detachNormalBuyerEmail({ merchantId: session.merchantId, sessionId: session.sessionId },
            { expectedVersion: session.persistenceVersion, email: correction.patch.email! }, chatClaim);
        } catch (error) {
          if (error instanceof Error && error.message === "checkout_buyer_identity_review_required"
            || error instanceof ConflictException && error.message === "CHECKOUT_SESSION_VERSION_CONFLICT") {
            const canonical = await this.repository.getSession(session.merchantId, session.sessionId) ?? session;
            return { ...correction, session: canonical, blocked: true,
              message: "A identidade e os benefícios deste checkout precisam de revisão antes de corrigir o e-mail." };
          }
          throw error;
        }
        if (detached) {
          working = await this.processCustomerInput(detached, correction.patch.email!, undefined, merchantName, chatClaim);
          return { ...correction, session: working };
        }
        // Only actual absence of NORMAL in both durable tables may use legacy
        // correction. A malformed NORMAL record never reaches this branch.
      }
      // Changing identity must not carry a prior account or its proof to a new email.
      working = {
        ...working, globalUserId: `usr_${randomUUID()}`, shipping: undefined, shippingOptions: undefined,
        customer: {
          ...working.customer, email_verified: false, otp_code: "", otp_expires_at: "", recognized_buyer: false, isReturning: false,
          externalCustomerId: undefined, asaasCustomerId: undefined, phone_verified: false, phone_otp_code: "",
          ...(previous.email_verified ? { fullName: undefined, cpf: undefined, phone: undefined, address: undefined, address_verified: false } : {}),
        },
      };
      // Revoke the old code before attempting delivery, including delivery failure.
      working = await commitCheckoutMutation(this.repository, { expected: session, next: working });
      working = await this.processCustomerInput(working, correction.patch.email!, undefined, merchantName);
      return { ...correction, session: working };
    }
    working = await commitCheckoutMutation(this.repository, { expected: session, next: working });
    return { ...correction, session: working };
  }

  async saveDeliveryAddress(session: CheckoutSession): Promise<void> {
    await this.savedAddresses?.saveComplete(session);
  }

  private buildCustomerPatch(
    userMessage: string,
    existing: CustomerHints | undefined,
    lastAgentTurn: string | undefined
  ): Partial<CustomerHints> | null {
    const patch: Partial<CustomerHints> = {};
    const addr = existing?.address ?? {};

    let currentEmail = existing?.email;
    const otpPending = Boolean(existing?.otp_code);
    if (!currentEmail || (!otpPending && !existing?.email_verified)) {
      const email = extractEmail(userMessage);
      if (email) {
        patch.email = email.toLowerCase();
        currentEmail = patch.email;
      }
    }

    // A contact email does not start account authentication. Previously issued
    // challenges may still be consumed without making checkout wait for them.
    if (currentEmail && !existing?.email_verified && existing?.otp_code && !patch.email && this.otpService) {
      const isNewEmail = Boolean(patch.email);
      const otpResult = this.otpService.processEmailOtp(
        userMessage,
        existing,
        currentEmail,
        isNewEmail
      );
      if (otpResult) {
        Object.assign(patch, otpResult);
        // If OTP was generated or verified as a terminal action, return early
        if (otpResult.email_verified || (otpResult.otp_code && !otpResult.email)) {
          return Object.keys(patch).length === 0 ? null : patch;
        }
      }
    }

    // An 11-digit mobile reply is not a CPF, even though both share a length.
    const phone = extractPhone(userMessage);
    const explicitCpf = /\bCPF\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/i.test(userMessage);
    // The first message has no previous agent turn. A valid mobile supplied
    // there must not be consumed as CPF just because both contain 11 digits.
    const answeringPhone = /\b(celular|telefone|DDD)\b/i.test(lastAgentTurn ?? "")
      || (!existing?.phone && !!phone && isBrazilianMobilePhone(phone) && !explicitCpf);
    if (!existing?.cpf && !answeringPhone) {
      const cpf = extractCpf(userMessage);
      if (cpf) patch.cpf = cpf;
    }

    const currentPhone = existing?.phone;
    if (!currentPhone || (!isBrazilianMobilePhone(currentPhone) && !(existing?.phone_verified === true && /^\+?\d{10,15}$/.test(currentPhone)))) {
      const cpfInThisTurn = patch.cpf ?? existing?.cpf;
      if (phone && phone !== cpfInThisTurn) {
        if (this.otpService) {
          this.otpService.validateBrazilianMobilePhone(phone);
        } else if (!isBrazilianMobilePhone(phone)) {
          throw new OtpValidationError(
            "Informe um celular com DDD (ex: 11 98888-7777) para contato sobre o pedido."
          );
        }
        patch.phone = phone;
      }
    }

    // Email proves identity. The phone is contact data and does not start an OTP.

    if (!existing?.address?.zip) {
      const zip = extractCep(userMessage);
      if (zip) patch.address = { ...addr, zip };
    }

    if (!existing?.fullName) {
      let name = extractName(userMessage, lastAgentTurn);
      if (!name) name = extractStandaloneName(userMessage);
      if (name) patch.fullName = name;
    }

    return Object.keys(patch).length === 0 ? null : patch;
  }

  mergeCustomers(s: CheckoutSession, partial: Partial<CustomerHints>): CheckoutSession {
    return {
      ...s,
      customer: this.mergeHints(s.customer, partial),
      updatedAt: new Date().toISOString()
    };
  }

  mergeHints(a: CustomerHints | undefined, b: Partial<CustomerHints>): CustomerHints {
    const { address: addrPatch, ...rest } = b;
    const merged = { ...(a ?? {}), ...rest } as CustomerHints;
    if (addrPatch !== undefined) merged.address = this.mergeAddr(a?.address, addrPatch);
    return merged;
  }

  mergeAddr(
    a: CustomerHints["address"] | undefined,
    b: Partial<NonNullable<CustomerHints["address"]>> | undefined
  ): CustomerHints["address"] | undefined {
    if (!b && !a) return undefined;
    return {
      ...(a ?? {}),
      ...(b ?? {})
    };
  }

  private async recognizeAndPersistVerifiedBuyer(session: CheckoutSession, trustedGlobalUserId?: string): Promise<CheckoutSession> {
    if (!this.recognitionService) return session;
    session = structuredClone(session);

    const result = await this.recognitionService.recognizeVerifiedBuyer(
      session,
      (s, p) => this.mergeCustomers(s, p),
      trustedGlobalUserId,
    );

    if (trustedGlobalUserId !== undefined && (result.session.globalUserId !== trustedGlobalUserId
      || result.globalUserId !== undefined && result.globalUserId !== trustedGlobalUserId)) {
      throw new UnauthorizedException("checkout_buyer_session_binding_mismatch");
    }

    let next = result.session;
    if (result.globalUserId && result.globalUserId !== next.globalUserId) {
      next = {
        ...next,
        globalUserId: result.globalUserId,
        updatedAt: new Date().toISOString()
      };
    }
    next = await commitCheckoutMutation(this.repository, { expected: session, next });
    await this.persistenceService?.ensureBuyerAccountPersisted(next, false, trustedGlobalUserId);
    return next;
  }

  private async deliverEmailOtp(input: {
    session: CheckoutSession;
    email?: string;
    code: string;
    merchantName?: string;
  }): Promise<void> {
    const email = input.email?.trim().toLowerCase();
    if (!email) throw new OtpDeliveryError();

    try {
      const result = await this.emailSender?.send({
        to: email,
        merchantId: input.session.merchantId,
        from: process.env.RESEND_NOREPLY_EMAIL || process.env.RESEND_FROM_EMAIL,
        subject: `${input.code} é seu código de confirmação`,
        html: this.otpEmailHtml(input.code, input.merchantName),
        requireDelivery: true,
        idempotencyKey: `checkout-otp:${input.session.merchantId}:${input.session.sessionId}:${input.code}`,
      });
      if (result?.status === "sent" && result.messageId.trim()) return;
    } catch {
      // A code delivered to a phone cannot prove possession of this email.
      // Keep the challenge uncommitted until its own channel accepts delivery.
    }
    throw new OtpDeliveryError();
  }

  private otpEmailHtml(code: string, merchantName?: string): string {
    const name = escapeHtml(merchantName?.trim() || "a loja");
    return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px"><p>Use este código para confirmar seu e-mail no checkout de <strong>${name}</strong>:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center">${code}</p><p style="color:#667085;font-size:13px">O código expira em 10 minutos. Se você não iniciou esta compra, ignore este e-mail.</p></div>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
