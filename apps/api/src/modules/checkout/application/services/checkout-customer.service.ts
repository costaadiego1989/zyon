import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CheckoutSession, CustomerHints } from "@aacp/shared-types";
import { CHECKOUT_REPOSITORY, type CheckoutRepository } from "../../domain/ports/checkout-repository.port.js";
import { BrevoBuyerEmailNotifier } from "../../infrastructure/brevo-buyer-email.notifier.js";
import {
  extractCep,
  extractCpf,
  extractEmail,
  extractName,
  extractStandaloneName,
  extractOtp,
  extractPhone
} from "../../domain/services/customer-extraction.service.js";

@Injectable()
export class CheckoutCustomerService {
  constructor(
    @Inject(CHECKOUT_REPOSITORY) private readonly repository: CheckoutRepository,
    @Optional() private readonly buyerEmailNotifier?: BrevoBuyerEmailNotifier
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
    const working = await this.repository.saveSession(this.mergeCustomers(session, patch));

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

    return working;
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

    if (currentEmail && !existing?.email_verified) {
      if (!existing?.otp_code && !patch.otp_code && patch.email) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        patch.otp_code = code;
        console.log(`\n=========================================\n🔐 OTP GERADO PARA ${currentEmail}: ${code}\n=========================================\n`);
      } else if (existing?.otp_code) {
        const extracted = extractOtp(userMessage);
        if (extracted === existing.otp_code) {
          patch.email_verified = true;
          patch.otp_code = "";
        }
      }
    }

    if (!existing?.cpf) {
      const cpf = extractCpf(userMessage);
      if (cpf) patch.cpf = cpf;
    }
    if (!existing?.phone) {
      const phone = extractPhone(userMessage);
      const cpfInThisTurn = patch.cpf ?? existing?.cpf;
      if (phone && phone !== cpfInThisTurn) patch.phone = phone;
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
}
