import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CheckoutSession, CustomerHints } from "@aacp/shared-types";
import { CHECKOUT_SESSION_REPOSITORY, type CheckoutSessionRepository } from "../../domain/ports/checkout-session.repository.port.js";
import { BrevoBuyerEmailNotifier } from "../../infrastructure/brevo-buyer-email.notifier.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import {
  extractCep,
  extractCpf,
  extractEmail,
  extractName,
  extractStandaloneName,
  extractOtp,
  extractPhone
} from "../../domain/services/customer-extraction.service.js";

export class OtpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpValidationError";
  }
}

@Injectable()
export class CheckoutCustomerService {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly repository: CheckoutSessionRepository,
    @Optional() private readonly buyerEmailNotifier?: BrevoBuyerEmailNotifier,
    @Optional() @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyerAccounts?: BuyerAccountRepository
  ) {}

  async processCustomerInput(
    session: CheckoutSession,
    userMessage: string,
    lastAgentTurn: string | undefined,
    merchantName: string | undefined
  ): Promise<CheckoutSession> {
    const patch = this.buildCustomerPatch(userMessage, session.customer, lastAgentTurn);
    if (!patch) return session;

    let nextGlobalUserId = session.globalUserId;
    if (patch.email) {
      const existingSessions = await this.repository.findSessionsByEmail(session.merchantId, patch.email);
      const previousSession = this.pickPreviousSession(existingSessions, session.sessionId);
      const existingAccount = await this.buyerAccounts?.findByEmail(patch.email) ?? null;
      const recognizedBuyer = Boolean(existingAccount || previousSession);
      patch.recognized_buyer = recognizedBuyer;
      patch.isReturning = recognizedBuyer;
      if (existingAccount?.globalUserId) {
        nextGlobalUserId = existingAccount.globalUserId;
      } else if (previousSession?.globalUserId) {
        nextGlobalUserId = previousSession.globalUserId;
      }
    }

    const hadEmailAlready = Boolean(session.customer?.email?.trim());
    let working = this.mergeCustomers(session, patch);
    if (nextGlobalUserId !== working.globalUserId) {
      working = {
        ...working,
        globalUserId: nextGlobalUserId,
        updatedAt: new Date().toISOString()
      };
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
      working = await this.recognizeVerifiedBuyer(working);
    }

    return working;
  }

  private buildCustomerPatch(
    userMessage: string,
    existing: CustomerHints | undefined,
    lastAgentTurn: string | undefined
  ): Partial<CustomerHints> | null {
    const patch: Partial<CustomerHints> = {};
    const addr = existing?.address ?? {};

    const resendEmail = /reenviar.*(c[oó]digo|email|e-mail)/i.test(userMessage);
    const resendSms = /reenviar.*(c[oó]digo|sms|celular)/i.test(userMessage);

    // --- E-mail & OTP flow ---
    let currentEmail = existing?.email;
    const otpPending = Boolean(existing?.otp_code);
    if (!currentEmail || (!otpPending && !existing?.email_verified)) {
      const email = extractEmail(userMessage);
      if (email) {
        patch.email = email.toLowerCase();
        currentEmail = patch.email;
      }
    }

    if (currentEmail && !existing?.email_verified) {
      if (resendEmail && existing?.otp_code) {
        // Reset and regenerate email OTP
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        patch.otp_code = code;
        console.log(`\n=========================================\n🔄 OTP REENVIADO PARA ${currentEmail}: ${code}\n=========================================\n`);
        return patch;
      } else if (!existing?.otp_code && !patch.otp_code && patch.email) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        patch.otp_code = code;
        console.log(`\n=========================================\n🔐 OTP GERADO PARA ${currentEmail}: ${code}\n=========================================\n`);
      } else if (existing?.otp_code && !resendEmail) {
        const extracted = extractOtp(userMessage);
        if (extracted === existing.otp_code) {
          patch.email_verified = true;
          patch.otp_code = "";
          return patch;
        } else if (extracted && this.looksLikeOtpAttempt(userMessage)) {
          throw new OtpValidationError("Código de verificação inválido. Por favor, confira o código enviado para o seu e-mail e tente novamente.");
        }
      }
    }

    // --- CPF flow ---
    if (!existing?.cpf) {
      const cpf = extractCpf(userMessage);
      if (cpf) patch.cpf = cpf;
    }

    // --- Phone & SMS OTP flow ---
    let currentPhone = existing?.phone;
    const phoneOtpPending = Boolean(existing?.phone_otp_code);
    if (!currentPhone || (!phoneOtpPending && !existing?.phone_verified)) {
      const phone = extractPhone(userMessage);
      const cpfInThisTurn = patch.cpf ?? existing?.cpf;
      if (phone && phone !== cpfInThisTurn) {
        patch.phone = phone;
        currentPhone = phone;
      }
    }

    if (currentPhone && !existing?.phone_verified) {
      if (resendSms && existing?.phone_otp_code) {
        // Reset and regenerate SMS OTP
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        patch.phone_otp_code = code;
        console.log(`\n=========================================\n🔄 SMS OTP REENVIADO PARA ${currentPhone}: ${code}\n=========================================\n`);
        return patch;
      } else if (!existing?.phone_otp_code && !patch.phone_otp_code && patch.phone) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        patch.phone_otp_code = code;
        console.log(`\n=========================================\n🔐 SMS OTP GERADO PARA ${currentPhone}: ${code}\n=========================================\n`);
      } else if (existing?.phone_otp_code && !resendSms) {
        const extracted = extractOtp(userMessage);
        console.log(`\n🔍 OTP COMPARAÇÃO: extraído="${extracted}" esperado="${existing.phone_otp_code}" match=${extracted === existing.phone_otp_code}\n`);
        if (extracted === existing.phone_otp_code) {
          patch.phone_verified = true;
          patch.phone_otp_code = "";
          return patch;
        } else if (extracted && this.looksLikeOtpAttempt(userMessage)) {
          throw new OtpValidationError("Código de verificação do celular inválido. Por favor, confira o código enviado por SMS e tente novamente.");
        }
      }
    }

    // --- Address zip flow ---
    if (!existing?.address?.zip) {
      const zip = extractCep(userMessage);
      if (zip) patch.address = { ...addr, zip };
    }

    // --- Name flow ---
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

  private looksLikeOtpAttempt(userMessage: string): boolean {
    const text = userMessage.trim();
    const digits = text.replace(/\D/g, "");
    if (/(?:otp|c[o\u00f3]digo|code)/i.test(text)) return true;
    if (digits.length < 4 || digits.length > 6) return false;
    return !extractCpf(text) && !extractPhone(text) && !extractCep(text);
  }

  private pickPreviousSession(sessions: CheckoutSession[], currentSessionId: string): CheckoutSession | null {
    return sessions
      .filter((session) => session.sessionId !== currentSessionId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
  }

  private async recognizeVerifiedBuyer(session: CheckoutSession): Promise<CheckoutSession> {
    const email = session.customer?.email?.trim().toLowerCase();
    if (!email) return session;

    const account = await this.buyerAccounts?.findByEmail(email) ?? null;
    const priorSessions = await this.repository.findSessionsByEmail(session.merchantId, email);
    const previousSession = this.pickPreviousSession(priorSessions, session.sessionId);
    const isRecognized = Boolean(
      account ||
      previousSession ||
      session.customer?.recognized_buyer ||
      session.customer?.isReturning
    );
    if (!isRecognized) return session;

    const address = this.pickBestAddress(
      session.customer?.address,
      account?.address,
      previousSession?.customer?.address
    );
    const patch: Partial<CustomerHints> = {
      recognized_buyer: true,
      isReturning: true,
      fullName: session.customer?.fullName ?? account?.displayName ?? previousSession?.customer?.fullName,
      phone: session.customer?.phone ?? account?.phone ?? previousSession?.customer?.phone,
      phone_verified: session.customer?.phone_verified ?? Boolean(account?.phone || previousSession?.customer?.phone_verified),
      cpf: session.customer?.cpf ?? account?.cpf ?? previousSession?.customer?.cpf,
      address,
      address_verified: session.customer?.address_verified ?? Boolean(
        this.isCompleteAddress(account?.address) ||
        previousSession?.customer?.address_verified ||
        this.isCompleteAddress(previousSession?.customer?.address)
      )
    };

    let next = this.mergeCustomers(session, patch);
    const recognizedGlobalUserId = account?.globalUserId ?? previousSession?.globalUserId;
    if (recognizedGlobalUserId && recognizedGlobalUserId !== next.globalUserId) {
      next = {
        ...next,
        globalUserId: recognizedGlobalUserId,
        updatedAt: new Date().toISOString()
      };
    }
    if (account) {
      const nextAccountName = !account.displayName && patch.fullName ? patch.fullName : undefined;
      const nextAccountPhone = !account.phone && patch.phone ? patch.phone : undefined;
      const nextAccountAddress = !account.address && patch.address ? patch.address : undefined;
      const nextAccountCpf = !account.cpf && patch.cpf ? patch.cpf : undefined;
      if (nextAccountName || nextAccountPhone || nextAccountAddress || nextAccountCpf) {
        await this.buyerAccounts?.save(
          account.withUpdatedProfile(nextAccountName, nextAccountPhone, nextAccountAddress, nextAccountCpf)
        );
      }
    }
    await this.repository.saveSession(next);
    return next;
  }

  private pickBestAddress(
    current?: CustomerHints["address"],
    account?: CustomerHints["address"],
    previous?: CustomerHints["address"]
  ): CustomerHints["address"] | undefined {
    for (const candidate of [current, account, previous]) {
      if (this.isCompleteAddress(candidate)) return candidate;
    }
    const merged = {
      ...(previous ?? {}),
      ...(account ?? {}),
      ...(current ?? {})
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private isCompleteAddress(address?: CustomerHints["address"]): boolean {
    return Boolean(
      address?.zip &&
      address.street &&
      address.city &&
      address.state &&
      address.number &&
      address.complement !== undefined
    );
  }
}
