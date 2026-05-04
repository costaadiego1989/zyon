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
