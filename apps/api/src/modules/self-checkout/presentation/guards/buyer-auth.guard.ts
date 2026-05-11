import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface BuyerJwtPayload {
  sub: string;
  aud: string;
  email: string;
  exp: number;
}

function verifyBuyerToken(token: string, secret: string): BuyerJwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length || !timingSafeEqual(expectedBuf, signatureBuf)) {
    throw new Error("invalid_signature");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as BuyerJwtPayload;
  if (decoded.exp <= Math.floor(Date.now() / 1000)) throw new Error("expired");
  return decoded;
}

@Injectable()
export class BuyerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; buyer?: BuyerJwtPayload }>();
    const auth = req.headers["authorization"];
    if (!auth?.startsWith("Bearer ")) throw new UnauthorizedException("BUYER_TOKEN_REQUIRED");

    const secret = process.env.BUYER_JWT_SECRET ?? "buyer-dev-secret";
    let payload: BuyerJwtPayload;
    try {
      payload = verifyBuyerToken(auth.slice(7), secret);
    } catch {
      throw new UnauthorizedException("INVALID_BUYER_TOKEN");
    }

    if (payload.aud !== "buyer.aacp") throw new ForbiddenException("WRONG_AUDIENCE");
    req.buyer = payload;
    return true;
  }
}
