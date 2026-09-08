import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { BuyerJwtService, type BuyerPrincipal } from "../../buyer-account/domain/services/buyer-jwt.service.js";
import { BUYER_ACCOUNT_REPOSITORY, type BuyerAccountRepository } from "../../buyer-account/domain/ports/buyer-account-repository.port.js";
import type { TrustedCheckoutBuyer } from "../../checkout/application/services/trusted-checkout-buyer.js";

@Injectable()
export class ResolveEmbedBuyerService {
  constructor(
    private readonly jwt: BuyerJwtService,
    @Inject(BUYER_ACCOUNT_REPOSITORY) private readonly buyers: BuyerAccountRepository,
  ) {}

  async resolve(merchantId: string, token: unknown): Promise<TrustedCheckoutBuyer | undefined> {
    if (token === undefined) return undefined;
    if (typeof token !== "string" || token.length > 8192 || !token.trim() || token !== token.trim()) {
      throw new UnauthorizedException("embed_buyer_token_invalid");
    }
    let principal: BuyerPrincipal;
    try {
      principal = this.jwt.verify(token);
      // Signature validation alone must not accept malformed authenticated claims.
      const header = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
      const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
      if (header.alg !== "HS256" || header.typ !== "JWT" || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.exp <= payload.iat ||
        payload.iat > Math.floor(Date.now() / 1000) + 60 ||
        typeof principal.globalUserId !== "string" || !principal.globalUserId.trim() || principal.globalUserId.length > 191 ||
        typeof principal.email !== "string" || !principal.email.includes("@") || principal.email.length > 320 ||
        (principal.merchantId !== undefined && (typeof principal.merchantId !== "string" || !principal.merchantId.trim()))) {
        throw new Error("invalid_claims");
      }
    } catch {
      throw new UnauthorizedException("embed_buyer_token_invalid");
    }
    if (principal.merchantId !== undefined && principal.merchantId !== merchantId) {
      throw new UnauthorizedException("embed_buyer_merchant_mismatch");
    }
    const account = await this.buyers.findByGlobalUserId(principal.globalUserId);
    if (!account || account.globalUserId !== principal.globalUserId || account.email !== principal.email.trim().toLowerCase()) {
      throw new UnauthorizedException("embed_buyer_token_invalid");
    }
    return {
      globalUserId: account.globalUserId,
      customer: {
        email: account.email,
        email_verified: true,
        fullName: account.displayName,
        phone: account.phone,
        cpf: account.cpf,
        asaasCustomerId: account.asaasCustomerId,
        address: account.address ? { ...account.address } : undefined,
      },
    };
  }
}
