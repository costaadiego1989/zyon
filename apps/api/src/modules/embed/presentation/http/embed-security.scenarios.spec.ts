import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";

function mockCtx(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers })
    })
  } as Parameters<EmbedAuthGuard["canActivate"]>[0];
}

describe("EmbedAuthGuard security scenarios", () => {
  const secret = Buffer.from("embed-security-battery-secret-32chs");
  it("development bypass cannot authenticate in production", () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousBypass = process.env.EMBED_DEV_BYPASS;
    try {
      process.env.NODE_ENV = "production";
      process.env.EMBED_DEV_BYPASS = "true";
      const guard = new EmbedAuthGuard(new EmbedTokenService({ value: secret }));
      assert.throws(() => guard.canActivate(mockCtx({})), UnauthorizedException);
      assert.throws(() => guard.canActivate(mockCtx({ "x-aacp-embed-token": "__dev_bypass__" })), UnauthorizedException);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousBypass === undefined) delete process.env.EMBED_DEV_BYPASS;
      else process.env.EMBED_DEV_BYPASS = previousBypass;
    }
  });

  it("requires token header", () => {
    const guard = new EmbedAuthGuard(new EmbedTokenService({ value: secret }));
    assert.throws(() => guard.canActivate(mockCtx({})), UnauthorizedException);
  });

  it("rejects tampered MAC", () => {
    const svc = new EmbedTokenService({ value: secret });
    const now = Math.floor(Date.now() / 1000);
    let tok = svc.sign({
      typ: "aacp_embed_v1",
      merchantId: "m1",
      issuedAtUnix: now,
      expiresAtUnix: now + 400,
      nonce: "n_mac"
    });
    tok = tok.slice(0, -4) + "ZZZZ";

    const guard = new EmbedAuthGuard(svc);
    assert.throws(() => guard.canActivate(mockCtx({ "x-aacp-embed-token": tok })), UnauthorizedException);
  });

  it("rejects expired token", () => {
    const svc = new EmbedTokenService({ value: secret });
    const now = Math.floor(Date.now() / 1000);
    const tok = svc.sign({
      typ: "aacp_embed_v1",
      merchantId: "m1",
      issuedAtUnix: now - 200,
      expiresAtUnix: now - 1,
      nonce: "n_exp"
    });
    const guard = new EmbedAuthGuard(svc);
    assert.throws(() => guard.canActivate(mockCtx({ "x-aacp-embed-token": tok })), UnauthorizedException);
  });
});
