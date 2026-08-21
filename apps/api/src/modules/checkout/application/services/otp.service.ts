import { Injectable, Logger } from "@nestjs/common";
import type { CustomerHints } from "@zyon/shared-types";
import {
  extractEmail,
  extractOtp,
  extractPhone,
  extractCpf,
  extractCep,
  isBrazilianMobilePhone
} from "../../domain/services/customer-extraction.service.js";

export class OtpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpValidationError";
  }
}

/**
 * Handles OTP generation, validation, and resend logic for email and phone.
 * Extracted from CheckoutCustomerService to satisfy SRP.
 *
 * Single responsibility: OTP lifecycle (generate, validate, resend).
 * Does NOT handle buyer recognition, persistence, or email capture notifications.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  /**
   * Generate a 6-digit OTP code using crypto-secure random.
   */
  generateCode(): string {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.logger.warn(`[OTP-GENERATED] code=${code}`);
    return code;
  }

  /**
   * Determine if user is requesting an email OTP resend.
   */
  isEmailResendRequest(userMessage: string): boolean {
    return /reenviar.*(c[oó]digo|email|e-mail)/i.test(userMessage);
  }

  /**
   * Determine if user is requesting an SMS OTP resend.
   */
  isSmsResendRequest(userMessage: string): boolean {
    return /reenviar.*(c[oó]digo|sms|celular)/i.test(userMessage);
  }

  /**
   * Process email OTP flow: resend, generation, or validation.
   * Returns a patch to be merged into the customer hints, or null if no OTP action.
   * Throws OtpValidationError on invalid code attempt.
   */
  processEmailOtp(
    userMessage: string,
    existing: CustomerHints | undefined,
    currentEmail: string | undefined,
    isNewEmail: boolean
  ): Partial<CustomerHints> | null {
    if (!currentEmail || existing?.email_verified) return null;

    const resendEmail = this.isEmailResendRequest(userMessage);

    // Resend flow
    if (resendEmail && existing?.otp_code) {
      const code = this.generateCode();
      return { otp_code: code };
    }

    // Generation flow: trigger on new email or kickoff intent
    if (!existing?.otp_code) {
      const kickoff = /iniciar\s+cadastro|come[cç]ar\s+cadastro|quero\s+cadastrar/i.test(userMessage.trim());
      if (isNewEmail || kickoff) {
        const code = this.generateCode();
        return { otp_code: code, email: currentEmail.toLowerCase() };
      }
      return null;
    }

    // Validation flow
    if (existing.otp_code && !resendEmail) {
      const extracted = extractOtp(userMessage);
      if (extracted === existing.otp_code) {
        return {
          email_verified: true,
          otp_code: "",
          email: currentEmail.toLowerCase()
        };
      } else if (extracted && this.looksLikeOtpAttempt(userMessage)) {
        throw new OtpValidationError(
          "Código de verificação inválido. Por favor, confira o código enviado para o seu e-mail e tente novamente."
        );
      }
    }

    return null;
  }

  /**
   * Process phone OTP flow: resend, generation, or validation.
   * Returns a patch to be merged into the customer hints, or null if no action.
   * Throws OtpValidationError on invalid code attempt or invalid phone format.
   */
  processPhoneOtp(
    userMessage: string,
    existing: CustomerHints | undefined,
    currentPhone: string | undefined,
    isNewPhone: boolean
  ): Partial<CustomerHints> | null {
    if (!currentPhone || existing?.phone_verified) return null;

    const resendSms = this.isSmsResendRequest(userMessage);

    // Resend flow
    if (resendSms && existing?.phone_otp_code) {
      const code = this.generateCode();
      return { phone_otp_code: code };
    }

    // Generation flow
    if (!existing?.phone_otp_code && isNewPhone) {
      const code = this.generateCode();
      return { phone_otp_code: code };
    }

    // Validation flow
    if (existing?.phone_otp_code && !resendSms) {
      const extracted = extractOtp(userMessage);
      if (extracted === existing.phone_otp_code) {
        return {
          phone_verified: true,
          phone_otp_code: ""
        };
      } else if (extracted && this.looksLikeOtpAttempt(userMessage)) {
        throw new OtpValidationError(
          "Código de verificação do celular inválido. Por favor, confira o código enviado por SMS e tente novamente."
        );
      }
    }

    return null;
  }

  /**
   * Validate that a phone number is a valid Brazilian mobile.
   * Throws OtpValidationError if invalid.
   */
  validateBrazilianMobilePhone(phone: string): void {
    if (!isBrazilianMobilePhone(phone)) {
      throw new OtpValidationError(
        "Precisamos de um celular com DDD (ex: 11 98888-7777) para enviar o rastreio pelo WhatsApp."
      );
    }
  }

  /**
   * Heuristic: does the message look like an OTP attempt?
   */
  private looksLikeOtpAttempt(userMessage: string): boolean {
    const text = userMessage.trim();
    const digits = text.replace(/\D/g, "");
    if (/(?:otp|c[oó]digo|code)/i.test(text)) return true;
    if (digits.length < 4 || digits.length > 6) return false;
    return !extractCpf(text) && !extractPhone(text) && !extractCep(text);
  }
}
