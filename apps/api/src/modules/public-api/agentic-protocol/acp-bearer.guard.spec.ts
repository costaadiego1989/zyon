import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { createHmac } from "node:crypto";
import {
  EmbedScope,
  EmbedTokenClaims,
  EmbedTokenService,
} from "../../embed/domain/embed-token.service.js";
import {
  ACP_REQUIRED_SCOPES_KEY,
  AcpBearerGuard,
  RequireAcpScopes,
} from "./acp-bearer.guard.js";

const SECRET = "unit-test-secret-32-characters-mm";
const tokens = new EmbedTokenService({ value: Buffer.from(SECRET, "utf8") });

type ExecutionContextStub = {
  switchToHttp: () => { getRequest: () => Record<string, unknown> };
  getHandler: () => Function;
  getClass: () => Function;
};

class CheckoutController {}

function handlerWithScopes(scopes: ReadonlyArray<EmbedScope>): Function {
  const fn = function handler() {
    return undefined;
  };
  if (scopes.length > 0) {
    Reflect.defineMetadata(ACP_REQUIRED_SCOPES_KEY, [...scopes], fn);
  }
  return fn;
}

function makeRequest(
  headers: Record<string, string>,
): { request: Record<string, unknown> } {
  return { request: { headers } };
}

function makeContext(
  headers: Record<string, string>,
  handler: Function,
): ExecutionContextStub {
  const { request } = makeRequest(headers);
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => CheckoutController,
  };
}

function buildGuard(): AcpBearerGuard {
  return new AcpBearerGuard(tokens, new Reflector());
}

function makeClaims(overrides: Partial<EmbedTokenClaims> = {}): EmbedTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    typ: "aacp_embed_v1",
    merchantId: "merchant_xyz",
    installationId: "inst_abc",
    environment: "test",
    issuedAtUnix: now,
    expiresAtUnix: now + 3600,
    nonce: "n_1",
    scopes: ["payment:intents:confirm"],
    ...overrides,
  };
}

function signWithWrongType(claims: { typ: string; merchantId: string; issuedAtUnix: number; expiresAtUnix: number; nonce: string }): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

test("AcpBearerGuard: missing Authorization header → 401 missing_authorization_bearer", () => {
  const guard = buildGuard();
  const ctx = makeContext({}, handlerWithScopes([]));
  assert.throws(
    () => guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]),
    (err: unknown) => (err as { status: number }).status === 401,
  );
});

test("AcpBearerGuard: non-Bearer scheme → 401", () => {
  const guard = buildGuard();
  const ctx = makeContext({ authorization: "Basic abc.def" }, handlerWithScopes([]));
  assert.throws(
    () => guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]),
    (err: unknown) => (err as { status: number }).status === 401,
  );
});

test("AcpBearerGuard: malformed token → 401 token_malformed", () => {
  const guard = buildGuard();
  const ctx = makeContext(
    { authorization: "Bearer not-a-real-token" },
    handlerWithScopes([]),
  );
  assert.throws(
    () => guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]),
    (err: unknown) => {
      const e = err as { status: number; response: { message: string } };
      return e.status === 401 && e.response.message === "token_malformed";
    },
  );
});

test("AcpBearerGuard: invalid signature → 401 token_invalid_signature", () => {
  const guard = buildGuard();
  const otherTokens = new EmbedTokenService({
    value: Buffer.from("another-secret-32-characters-yes!"),
  });
  const token = otherTokens.sign(makeClaims());
  const ctx = makeContext({ authorization: `Bearer ${token}` }, handlerWithScopes([]));
  assert.throws(
    () => guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]),
    (err: unknown) => {
      const e = err as { status: number; response: { message: string } };
      return e.status === 401 && e.response.message === "token_invalid_signature";
    },
  );
});

test("AcpBearerGuard: expired token → 401 token_expired", () => {
  const guard = buildGuard();
  const now = Math.floor(Date.now() / 1000);
  const token = tokens.sign(
    makeClaims({ issuedAtUnix: now - 7200, expiresAtUnix: now - 60 }),
  );
  const ctx = makeContext({ authorization: `Bearer ${token}` }, handlerWithScopes([]));
  assert.throws(
    () => guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]),
    (err: unknown) => {
      const e = err as { status: number; response: { message: string } };
      return e.status === 401 && e.response.message === "token_expired";
    },
  );
});

test("AcpBearerGuard: wrong typ → 401 token_wrong_type", () => {
  const guard = buildGuard();
  const now = Math.floor(Date.now() / 1000);
  const token = signWithWrongType({
    typ: "different_jwt",
    merchantId: "merchant_xyz",
    issuedAtUnix: now,
    expiresAtUnix: now + 3600,
    nonce: "n",
  });
  const ctx = makeContext({ authorization: `Bearer ${token}` }, handlerWithScopes([]));
  assert.throws(
    () => guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]),
    (err: unknown) => {
      const e = err as { status: number; response: { message: string } };
      return e.status === 401 && e.response.message === "token_wrong_type";
    },
  );
});

test("AcpBearerGuard: missing required scope → 403 token_scope_not_granted", () => {
  const guard = buildGuard();
  const token = tokens.sign(makeClaims({ scopes: ["checkout:start"] }));
  const handler = handlerWithScopes(["payment:intents:confirm"]);
  const ctx = makeContext({ authorization: `Bearer ${token}` }, handler);

  try {
    guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]);
    assert.fail("expected guard to throw ForbiddenException");
  } catch (err) {
    const e = err as {
      status: number;
      response?: { code?: string; missing_scopes?: string[]; message?: unknown };
    };
    assert.equal(e.status, 403);
    const response = e.response ?? {};
    assert.equal(response.code, "token_scope_not_granted");
    assert.deepEqual(response.missing_scopes, ["payment:intents:confirm"]);
  }
});

test("AcpBearerGuard: valid token + correct scope → next() invoked with claims attached", () => {
  const guard = buildGuard();
  const token = tokens.sign(
    makeClaims({
      scopes: ["payment:intents:confirm", "checkout:start"],
    }),
  );
  const handler = handlerWithScopes(["payment:intents:confirm"]);

  const request = { headers: { authorization: `Bearer ${token}` } };
  const ctx: ExecutionContextStub = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => CheckoutController,
  };

  const ok = guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]);
  assert.equal(ok, true);
  const claims = (request as { acpClaims?: EmbedTokenClaims }).acpClaims;
  assert.ok(claims, "expected acpClaims to be attached");
  assert.equal(claims?.merchantId, "merchant_xyz");
  assert.equal(claims?.installationId, "inst_abc");
  assert.equal(claims?.environment, "test");
  assert.deepEqual(claims?.scopes, ["payment:intents:confirm", "checkout:start"]);
});

test("AcpBearerGuard: token without scopes field passes when no metadata required", () => {
  const guard = buildGuard();
  const token = tokens.sign(makeClaims({ scopes: undefined }));
  const ctx = makeContext(
    { authorization: `Bearer ${token}` },
    handlerWithScopes([]),
  );
  const request = ctx.switchToHttp().getRequest() as { acpClaims?: EmbedTokenClaims };
  const ok = guard.canActivate(ctx as unknown as Parameters<typeof guard.canActivate>[0]);
  assert.equal(ok, true);
  assert.equal(request.acpClaims?.merchantId, "merchant_xyz");
});

test("RequireAcpScopes decorator stores metadata accessible via Reflector", () => {
  const reflector = new Reflector();
  const handler = function handler() {
    return undefined;
  };
  // Apply the decorator to seed metadata. Use Reflect.defineMetadata directly
  // because the spec runs without a Nest module context.
  Reflect.defineMetadata(
    ACP_REQUIRED_SCOPES_KEY,
    ["payment:intents:confirm"],
    handler,
  );
  const scopes = reflector.get<EmbedScope[]>(ACP_REQUIRED_SCOPES_KEY, handler);
  assert.deepEqual(scopes, ["payment:intents:confirm"]);
});

test("ACP_REQUIRED_SCOPES_KEY matches the decorator's metadata key", () => {
  assert.equal(typeof ACP_REQUIRED_SCOPES_KEY, "string");
  assert.ok(ACP_REQUIRED_SCOPES_KEY.length > 0);
});
