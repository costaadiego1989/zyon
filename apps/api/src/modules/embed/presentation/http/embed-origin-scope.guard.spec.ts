import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { EmbedTokenService, type EmbedScope, type EmbedTokenClaims } from "../../domain/embed-token.service.js";
import { EmbedAuthGuard } from "./embed-auth.guard.js";
import { EMBED_REQUIRED_SCOPE_KEY } from "./embed-scope.decorator.js";

const SECRET = Buffer.from("embed-origin-scope-secret-32-chars!!");

function tokenFor(claims: Partial<EmbedTokenClaims>): { svc: EmbedTokenService; token: string } {
  const svc = new EmbedTokenService({ value: SECRET });
  const now = Math.floor(Date.now() / 1000);
  const token = svc.sign({
    typ: "aacp_embed_v1",
    merchantId: "m1",
    issuedAtUnix: now,
    expiresAtUnix: now + 600,
    nonce: "n",
    ...claims
  });
  return { svc, token };
}

function ctx(headers: Record<string, string | undefined>, handler: () => void = () => {}) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => handler,
    getClass: () => class {}
  } as unknown as Parameters<EmbedAuthGuard["canActivate"]>[0];
}

function reflectorWithScope(scope: EmbedScope): { reflector: Reflector; handler: () => void } {
  const reflector = new Reflector();
  const handler = () => {};
  Reflect.defineMetadata(EMBED_REQUIRED_SCOPE_KEY, scope, handler);
  return { reflector, handler };
}

describe("EmbedAuthGuard origin binding", () => {
  it("accepts a request whose Origin matches the token allowedOrigin", () => {
    const { svc, token } = tokenFor({ allowedOrigin: "https://store.example" });
    const guard = new EmbedAuthGuard(svc);
    assert.equal(
      guard.canActivate(ctx({ "x-aacp-embed-token": token, origin: "https://store.example" })),
      true
    );
  });

  it("rejects a request whose Origin differs from allowedOrigin", () => {
    const { svc, token } = tokenFor({ allowedOrigin: "https://store.example" });
    const guard = new EmbedAuthGuard(svc);
    assert.throws(
      () => guard.canActivate(ctx({ "x-aacp-embed-token": token, origin: "https://evil.example" })),
      ForbiddenException
    );
  });

  it("falls back to Referer when Origin is absent", () => {
    const { svc, token } = tokenFor({ allowedOrigin: "https://store.example" });
    const guard = new EmbedAuthGuard(svc);
    assert.equal(
      guard.canActivate(ctx({ "x-aacp-embed-token": token, referer: "https://store.example/cart" })),
      true
    );
  });

  it("rejects when allowedOrigin is set but no Origin/Referer is sent", () => {
    const { svc, token } = tokenFor({ allowedOrigin: "https://store.example" });
    const guard = new EmbedAuthGuard(svc);
    assert.throws(
      () => guard.canActivate(ctx({ "x-aacp-embed-token": token })),
      ForbiddenException
    );
  });

  it("does not enforce origin when token carries no allowedOrigin", () => {
    const { svc, token } = tokenFor({});
    const guard = new EmbedAuthGuard(svc);
    assert.equal(guard.canActivate(ctx({ "x-aacp-embed-token": token, origin: "https://any.example" })), true);
  });
});

describe("EmbedAuthGuard scope enforcement", () => {
  it("allows when the token grants the required scope", () => {
    const { svc, token } = tokenFor({ scopes: ["checkout:start"] });
    const { reflector, handler } = reflectorWithScope("checkout:start");
    const guard = new EmbedAuthGuard(svc, reflector);
    assert.equal(guard.canActivate(ctx({ "x-aacp-embed-token": token }, handler)), true);
  });

  it("rejects when the token lacks the required scope", () => {
    const { svc, token } = tokenFor({ scopes: ["checkout:track"] });
    const { reflector, handler } = reflectorWithScope("payment:intents:create");
    const guard = new EmbedAuthGuard(svc, reflector);
    assert.throws(
      () => guard.canActivate(ctx({ "x-aacp-embed-token": token }, handler)),
      ForbiddenException
    );
  });

  it("rejects when the route requires a scope but the token has none", () => {
    const { svc, token } = tokenFor({});
    const { reflector, handler } = reflectorWithScope("checkout:start");
    const guard = new EmbedAuthGuard(svc, reflector);
    assert.throws(
      () => guard.canActivate(ctx({ "x-aacp-embed-token": token }, handler)),
      ForbiddenException
    );
  });

  it("skips scope enforcement when the route declares no required scope", () => {
    const { svc, token } = tokenFor({ scopes: ["checkout:start"] });
    const guard = new EmbedAuthGuard(svc, new Reflector());
    assert.equal(guard.canActivate(ctx({ "x-aacp-embed-token": token })), true);
  });

  it("still requires a token before any origin/scope check", () => {
    const { svc } = tokenFor({});
    const guard = new EmbedAuthGuard(svc);
    assert.throws(() => guard.canActivate(ctx({})), UnauthorizedException);
  });
});
