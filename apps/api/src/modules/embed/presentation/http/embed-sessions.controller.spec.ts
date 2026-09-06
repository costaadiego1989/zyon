import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmbedSessionsController } from "./embed-sessions.controller.js";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import type { ResolveInstallationForEmbedUseCase } from "../../../installations/application/installation.use-cases.js";

describe("EmbedSessionsController", () => {
  it("public service issuance requires a matching installation and refuses borrowed carts", async () => {
    const tokens = new EmbedTokenService({ value: Buffer.from("ctrl-spec-embed-secret-32chr!!!!") });
    const installation = { id: "ins-public", merchantId: "merchant-a", environment: "live", status: "active", allowedOrigins: ["https://a.example"], widgetVersion: "2" };
    const controller = new EmbedSessionsController(new IssueEmbedSessionUseCase(tokens), {
      async execute(input: any) {
        assert.equal(input.installationId, installation.id);
        assert.equal(input.merchantId, installation.merchantId);
        assert.equal(input.requestedOrigin, "https://a.example");
        return { installation, allowedOrigin: "https://a.example" };
      },
    } as never, { getProfile: async () => undefined } as never, {
      async execute(merchantId: string) { return { data: merchantId === "merchant-a" ? [installation] : [], hasMore: false }; },
    } as never);
    const issuer = { apiKey: { id: "internal-storefront", merchantId: "merchant-a", environment: "live" } };
    await assert.rejects(controller.issueSession(issuer, {}), /public_embed_origin_required/);
    await assert.rejects(controller.issueSession(issuer, { allowed_origin: "https://a.example", cart_ref: "borrowed" }), /public_embed_cart_ownership_required/);
    await assert.rejects(controller.issueSession(issuer, { allowed_origin: "https://attacker.example" }), /public_embed_installation_required/);
    await assert.rejects(controller.issueSession({ apiKey: { ...issuer.apiKey, merchantId: "merchant-b" } }, { allowed_origin: "https://a.example" }), /public_embed_installation_required/);
    const result = await controller.issueSession(issuer, { allowed_origin: "https://a.example", ttl_seconds: 86400, scopes: ["checkout:start", "payment:intents:create"] });
    const claims = tokens.verify(result.embed_session_token);
    assert.equal(claims.installationId, "ins-public");
    assert.equal(claims.cartRef, undefined);
    assert.equal(claims.expiresAtUnix - claims.issuedAtUnix, 900);
    assert.equal(claims.merchantId, "merchant-a");
  });

  it("issues an installation-bound token for the authenticated merchant", async () => {
    const tokens = new EmbedTokenService({ value: Buffer.from("ctrl-spec-embed-secret-32chr!!!!") });
    const issue = new IssueEmbedSessionUseCase(tokens);
    const resolver = {
      execute: async () => ({
        installation: {
          id: "ins_1",
          merchantId: "m_ok",
          name: "Storefront",
          environment: "test",
          status: "active",
          widgetVersion: "1.2.0",
          allowedOrigins: ["https://store.example"],
          createdAt: "2026-06-15T00:00:00.000Z",
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
        allowedOrigin: "https://store.example",
      }),
    } as unknown as ResolveInstallationForEmbedUseCase;
    const c = new EmbedSessionsController(issue, resolver, { getProfile: async () => undefined } as any);

    const out = await c.issueSession(
      { user: { merchantId: "m_ok", userId: "u", email: "e", role: "owner" } },
      {
        installation_id: "ins_1",
        ttl_seconds: 120,
        allowed_origin: "https://store.example",
        scopes: ["checkout:start", "payment:intents:create"],
        cart_ref: "cart_123"
      }
    );

    const claims = tokens.verify(out.embed_session_token);
    assert.equal(claims.merchantId, "m_ok");
    assert.equal(out.expires_at_unix - claims.issuedAtUnix, 120);
    assert.equal(claims.allowedOrigin, "https://store.example");
    assert.deepEqual(claims.scopes, ["checkout:start", "payment:intents:create"]);
    assert.equal(claims.cartRef, "cart_123");
    assert.equal(claims.installationId, "ins_1");
    assert.equal(claims.environment, "test");
    assert.equal(claims.widgetVersion, "1.2.0");
  });

  it("rejects merchant_id because tenant identity comes from credentials", async () => {
    const tokens = new EmbedTokenService({ value: Buffer.from("ctrl-spec-embed-secret-32chr!!!!") });
    const issue = new IssueEmbedSessionUseCase(tokens);
    const c = new EmbedSessionsController(
      issue,
      {
        execute: async () => {
          throw new Error("not_expected");
        },
      } as unknown as ResolveInstallationForEmbedUseCase,
      { getProfile: async () => undefined } as any,
    );

    await assert.rejects(
      c.issueSession(
        { user: { merchantId: "m_ok", userId: "u", email: "e", role: "owner" } },
        { merchant_id: "m_evil" } as never,
      ),
      /merchant_id_is_credential_derived/,
    );
  });
});
