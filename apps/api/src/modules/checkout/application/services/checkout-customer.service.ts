import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { customerCorrection, type CustomerCorrection } from "../../domain/services/customer-correction.js";
import type { CheckoutSession, CustomerHints } from "@zyon/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { BrevoBuyerEmailNotifier } from "../../infrastructure/brevo-buyer-email.notifier.js";
import {
  extractCep,
  extractCpf,
  extractEmail,
  extractName,
  extractStandaloneName,
  extractPhone,
  isBrazilianMobilePhone
} from "../../domain/services/customer-extraction.service.js";
import { OtpDeliveryError, OtpService, OtpValidationError } from "./otp.service.js";
import { BuyerRecognitionService } from "./buyer-recognition.service.js";
import { BuyerAccountPersistenceService } from "./buyer-account-persistence.service.js";
import { EMAIL_SENDER_PORT, type EmailSenderPort } from "../../../notifications/domain/ports/email-sender.port.js";
import { WHATSAPP_TEMPLATE_REPOSITORY, type WhatsAppTemplateRepositoryPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js";
import { WHATSAPP_TEMPLATE_SENDER, type WhatsAppTemplateSenderPort } from "../../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js";

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
    @Optional() @Inject(WHATSAPP_TEMPLATE_REPOSITORY) private readonly templates?: WhatsAppTemplateRepositoryPort,
    @Optional() @Inject(WHATSAPP_TEMPLATE_SENDER) private readonly whatsappTemplates?: WhatsAppTemplateSenderPort,
  ) {}

  async processCustomerInput(
    session: CheckoutSession,
    userMessage: string,
    lastAgentTurn: string | undefined,
    merchantName: string | undefined
  ): Promise<CheckoutSession> {
    const patch = this.buildCustomerPatch(userMessage, session.customer, lastAgentTurn);
    if (!patch) return session;

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

    await this.repository.saveSession(working);

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
      await this.repository.saveSession(working);
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
    return this.recognizeAndPersistVerifiedBuyer(session);
  }

  async correctCustomerInput(session: CheckoutSession, text: string, lastAgentTurn?: string, merchantName?: string): Promise<(CustomerCorrection & { session: CheckoutSession; message?: string; needsInput?: boolean; blocked?: boolean }) | null> {
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
      // Changing identity must not carry a prior account or its proof to a new email.
      working = {
        ...working, globalUserId: `usr_${randomUUID()}`, shipping: undefined, shippingOptions: undefined,
        customer: {
          ...working.customer, email_verified: false, otp_code: "", recognized_buyer: false, isReturning: false,
          externalCustomerId: undefined, asaasCustomerId: undefined, phone_verified: false, phone_otp_code: "",
          ...(previous.email_verified ? { fullName: undefined, cpf: undefined, phone: undefined, address: undefined, address_verified: false } : {}),
        },
      };
      // Revoke the old code before attempting delivery, including delivery failure.
      await this.repository.saveSession(working);
      working = await this.processCustomerInput(working, correction.patch.email!, undefined, merchantName);
    }
    if (["zip", "number", "complement"].includes(correction.field)) {
      working = { ...working, shipping: undefined, shippingOptions: undefined };
    }
    await this.repository.saveSession(working);
    return { ...correction, session: working };
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

    // Delegate email OTP processing
    if (currentEmail && !existing?.email_verified && this.otpService) {
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
    const answeringPhone = /\b(celular|telefone|DDD)\b/i.test(lastAgentTurn ?? "");
    if (!existing?.cpf && !answeringPhone) {
      const cpf = extractCpf(userMessage);
      if (cpf) patch.cpf = cpf;
    }

    const currentPhone = existing?.phone;
    if (!currentPhone || !isBrazilianMobilePhone(currentPhone)) {
      const phone = extractPhone(userMessage);
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

  private async recognizeAndPersistVerifiedBuyer(session: CheckoutSession): Promise<CheckoutSession> {
    if (!this.recognitionService) return session;

    const result = await this.recognitionService.recognizeVerifiedBuyer(
      session,
      (s, p) => this.mergeCustomers(s, p)
    );

    let next = result.session;
    if (result.globalUserId && result.globalUserId !== next.globalUserId) {
      next = {
        ...next,
        globalUserId: result.globalUserId,
        updatedAt: new Date().toISOString()
      };
    }
    await this.repository.saveSession(next);
    await this.persistenceService?.ensureBuyerAccountPersisted(next);
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
        from: process.env.RESEND_NOREPLY_EMAIL || process.env.RESEND_FROM_EMAIL,
        subject: `${input.code} é seu código de confirmação`,
        html: this.otpEmailHtml(input.code, input.merchantName),
        requireDelivery: true,
        idempotencyKey: `checkout-otp:${input.session.merchantId}:${input.session.sessionId}:${input.code}`,
      });
      if (result?.status === "sent" && result.messageId.trim()) return;
    } catch {
      // The transactional WhatsApp fallback below is available only after a
      // concrete Resend failure. It is not a second send on an accepted email.
    }

    if (await this.deliverWhatsAppOtp(input)) return;
    throw new OtpDeliveryError();
  }

  private async deliverWhatsAppOtp(input: {
    session: CheckoutSession;
    code: string;
  }): Promise<boolean> {
    const phone = input.session.customer?.phone;
    if (!phone || !isBrazilianMobilePhone(phone)) return false;

    const template = await this.templates
      ?.findByMerchantAndType(input.session.merchantId, "checkout_otp", "whatsapp")
      .catch(() => null);
    if (!template?.isActive || template.metaStatus !== "approved" || !template.twilioContentSid || !template.metaVariableMap) return false;

    const variables: Record<string, string> = {};
    for (const [position, name] of Object.entries(template.metaVariableMap)) {
      if (name !== "otpCode") return false;
      variables[position] = input.code;
    }
    if (!Object.keys(variables).length) return false;

    const result = await this.whatsappTemplates?.sendTemplate({
      merchantId: input.session.merchantId,
      type: "checkout_otp",
      toNumber: phone,
      contentSid: template.twilioContentSid,
      language: template.metaLanguage ?? "pt_BR",
      contentVariables: variables,
    }).catch(() => null);
    return result?.status === "sent" && Boolean(result.messageId.trim());
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
