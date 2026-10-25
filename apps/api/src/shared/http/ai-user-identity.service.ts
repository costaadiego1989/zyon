import { UnauthorizedException } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireSecret } from "../config/secret-config.js";
import { BuyerJwtService } from "../../modules/buyer-account/domain/services/buyer-jwt.service.js";

/** An anonymous visitor is identified by a server-signed credential, never an IP or supplied user ID. */
export class AiUserIdentityService {
  constructor(private readonly secret = requireSecret("JWT_SECRET", "")) {}

  resolve(input: { visitorToken?: unknown; buyerToken?: unknown; merchantId: string }) {
    if (input.buyerToken !== undefined && input.buyerToken !== "") {
      try {
        if (typeof input.buyerToken !== "string" || input.buyerToken.length > 8192) throw new Error();
        const buyer = new BuyerJwtService().verify(input.buyerToken);
        if (!buyer.globalUserId || buyer.merchantId && buyer.merchantId !== input.merchantId) throw new Error();
        return { userId: `buyer:${buyer.globalUserId}`, token: undefined };
      } catch { throw new UnauthorizedException("invalid_buyer_token"); }
    }
    if (input.visitorToken !== undefined && input.visitorToken !== "") {
      try {
        if (typeof input.visitorToken !== "string" || input.visitorToken.length > 2048) throw new Error();
        const [payload, signature, extra] = input.visitorToken.split(".");
        if (!payload || !signature || extra) throw new Error();
        const expected = Buffer.from(this.sign(payload));
        const actual = Buffer.from(signature);
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
        const now = Math.floor(Date.now() / 1000);
        if (claims.typ !== "ai_visitor_v1" || !/^visitor:[a-f0-9-]{36}$/.test(claims.sub) ||
          !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) || claims.iat > now || claims.exp <= now || claims.exp - claims.iat > 30 * 86400) throw new Error();
        return { userId: claims.sub as string, token: input.visitorToken };
      } catch { throw new UnauthorizedException("invalid_ai_visitor_token"); }
    }
    const userId = `visitor:${randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ typ: "ai_visitor_v1", sub: userId, iat: now, exp: now + 30 * 86400 })).toString("base64url");
    return { userId, token: `${payload}.${this.sign(payload)}` };
  }

  private sign(payload: string) { return createHmac("sha256", this.secret).update(`ai_visitor_v1:${payload}`).digest("base64url"); }
}
