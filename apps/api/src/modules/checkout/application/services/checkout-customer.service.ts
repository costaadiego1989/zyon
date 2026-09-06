import { Inject, Injectable, Optional } from "@nestjs/common";
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
import { OtpService, OtpValidationError } from "./otp.service.js";
import { BuyerRecognitionService } from "./buyer-recognition.service.js";
import { BuyerAccountPersistenceService } from "./buyer-account-persistence.service.js";

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
    private readonly persistenceService?: BuyerAccountPersistenceService
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

    if (patch.otp_code && this.buyerEmailNotifier) {
      const email = patch.email ?? session.customer?.email;
      if (email) {
        const merged = this.mergeHints(session.customer, patch);
        const buyerFirstHint = merged.fullName?.trim().split(/\s+/).filter(Boolean)[0];
        this.buyerEmailNotifier.sendOtpCode({
          buyerEmail: email.toLowerCase(),
          otpCode: patch.otp_code,
          merchantId: session.merchantId,
          merchantName,
          buyerFirstNameHint: buyerFirstHint
        });
      }
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

    if (!existing?.cpf) {
      const cpf = extractCpf(userMessage);
      if (cpf) patch.cpf = cpf;
    }

    let currentPhone = existing?.phone;
    const phoneOtpPending = Boolean(existing?.phone_otp_code);
    if (!currentPhone || (!phoneOtpPending && !existing?.phone_verified)) {
      const phone = extractPhone(userMessage);
      const cpfInThisTurn = patch.cpf ?? existing?.cpf;
      if (phone && phone !== cpfInThisTurn) {
        if (this.otpService) {
          this.otpService.validateBrazilianMobilePhone(phone);
        } else if (!isBrazilianMobilePhone(phone)) {
          throw new OtpValidationError(
            "Precisamos de um celular com DDD (ex: 11 98888-7777) para enviar o rastreio pelo WhatsApp."
          );
        }
        patch.phone = phone;
        currentPhone = phone;
      }
    }

    // Delegate phone OTP processing
    if (currentPhone && !existing?.phone_verified && this.otpService) {
      const isNewPhone = Boolean(patch.phone);
      const phoneOtpResult = this.otpService.processPhoneOtp(
        userMessage,
        existing,
        currentPhone,
        isNewPhone
      );
      if (phoneOtpResult) {
        Object.assign(patch, phoneOtpResult);
        if (phoneOtpResult.phone_verified) {
          return Object.keys(patch).length === 0 ? null : patch;
        }
      }
    }

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
}
