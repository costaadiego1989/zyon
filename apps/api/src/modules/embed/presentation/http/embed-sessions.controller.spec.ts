import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmbedSessionsController } from "./embed-sessions.controller.js";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";
import type { ResolveInstallationForEmbedUseCase } from "../../../installations/application/installation.use-cases.js";

describe("EmbedSessionsController", () => {
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
    const c = new EmbedSessionsController(issue, resolver);

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
