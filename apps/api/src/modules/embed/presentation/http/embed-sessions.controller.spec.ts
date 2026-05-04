import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EmbedSessionsController } from "./embed-sessions.controller.js";
import { IssueEmbedSessionUseCase } from "../../application/issue-embed-session.use-case.js";
import { EmbedTokenService } from "../../domain/embed-token.service.js";

describe("EmbedSessionsController", () => {
  it("issues token for authenticated merchant only", () => {
    const tokens = new EmbedTokenService({ value: Buffer.from("ctrl-spec-embed-secret-32chr!!!!") });
    const issue = new IssueEmbedSessionUseCase(tokens);
    const c = new EmbedSessionsController(issue);

    const out = c.issueSession(
      { user: { merchantId: "m_ok", userId: "u", email: "e", role: "owner" } },
      { ttl_seconds: 120, merchant_id: "m_evil" }
    );

    const claims = tokens.verify(out.embed_session_token);
    assert.equal(claims.merchantId, "m_ok");
    assert.equal(out.expires_at_unix - claims.issuedAtUnix, 120);
  });
});
