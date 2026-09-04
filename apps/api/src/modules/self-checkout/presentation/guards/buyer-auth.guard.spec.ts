import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BuyerAuthGuard } from "./buyer-auth.guard.js";

const SECRET = "buyer-dev-secret";

function issueToken(sub: string, email: string, opts: { exp?: number; aud?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub,
    email,
    aud: opts.aud ?? "buyer.aacp",
    iat: now,
    exp: opts.exp ?? now + 3600,
  })).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function makeContext(headers: Record<string, string>): { ctx: Parameters<BuyerAuthGuard["canActivate"]>[0]; req: Record<string, unknown> } {
  const req: Record<string, unknown> = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as Parameters<BuyerAuthGuard["canActivate"]>[0];
  return { ctx, req };
}

describe("BuyerAuthGuard", () => {
  const guard = new BuyerAuthGuard();

  it("accepts valid token and attaches buyer payload to request", () => {
    const token = issueToken("user_1", "buyer@test.com");
    const { ctx, req } = makeContext({ authorization: `Bearer ${token}` });

    const result = guard.canActivate(ctx);
    assert.equal(result, true);
    assert.ok(req.buyer);
    const buyer = req.buyer as { sub: string; email: string; aud: string };
    assert.equal(buyer.sub, "user_1");
    assert.equal(buyer.email, "buyer@test.com");
    assert.equal(buyer.aud, "buyer.aacp");
  });

  it("throws UnauthorizedException when no authorization header", () => {
    const { ctx } = makeContext({});
    assert.throws(
      () => guard.canActivate(ctx),
      { message: "BUYER_TOKEN_REQUIRED" }
    );
  });

  it("throws UnauthorizedException when authorization header is not Bearer", () => {
    const { ctx } = makeContext({ authorization: "Basic abc" });
    assert.throws(
      () => guard.canActivate(ctx),
      { message: "BUYER_TOKEN_REQUIRED" }
    );
  });

  it("throws UnauthorizedException for invalid signature", () => {
    const token = issueToken("user_1", "buyer@test.com");
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.tampered_signature`;
    const { ctx } = makeContext({ authorization: `Bearer ${tampered}` });

    assert.throws(
      () => guard.canActivate(ctx),
      { message: "INVALID_BUYER_TOKEN" }
    );
  });

  it("throws UnauthorizedException for expired token", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100;
    const token = issueToken("user_1", "buyer@test.com", { exp: pastExp });
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });

    assert.throws(
      () => guard.canActivate(ctx),
      { message: "INVALID_BUYER_TOKEN" }
    );
  });

  it("throws ForbiddenException for wrong audience", () => {
    const token = issueToken("user_1", "buyer@test.com", { aud: "merchant.aacp" });
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });

    assert.throws(
      () => guard.canActivate(ctx),
      { message: "WRONG_AUDIENCE" }
    );
  });

  it("throws UnauthorizedException for malformed JWT (missing parts)", () => {
    const { ctx } = makeContext({ authorization: "Bearer header.payload" });
    assert.throws(
      () => guard.canActivate(ctx),
      { message: "INVALID_BUYER_TOKEN" }
    );
  });
});
