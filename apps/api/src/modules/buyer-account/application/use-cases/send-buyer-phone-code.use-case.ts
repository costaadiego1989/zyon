import { Inject, Injectable } from "@nestjs/common";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../domain/ports/buyer-account-repository.port.js";

export interface OtpEntry {
  code: string;
  expiresAt: number;
}

export const otpStore = new Map<string, OtpEntry>();

export interface SendBuyerPhoneCodeRequest {
  phone: string;
}

@Injectable()
export class SendBuyerPhoneCodeUseCase {
  constructor(
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly repo: BuyerAccountRepository
  ) {}

  async execute(input: SendBuyerPhoneCodeRequest): Promise<{ sent: boolean }> {
    const normalized = input.phone.replace(/\D/g, "");
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 5 * 60 * 1000;

    otpStore.set(normalized, { code, expiresAt });

    // TODO: integrate WhatsApp/SMS provider (e.g., Twilio, Z-API, Evolution API)
    console.log(`[OTP] phone=${normalized} code=${code}`);

    return { sent: true };
  }
}
