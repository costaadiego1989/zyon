import { test } from "node:test";
import assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { EmbedAuthGuard } from "../../embed/presentation/http/embed-auth.guard.js";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";
import { CashbackEmbedController } from "./cashback.controllers.js";

test("VERIFIER CB-07 CB-13 an observation-only embed token cannot reserve or remove cashback", async () => {
  const tokens = new EmbedTokenService({ value: Buffer.from("verifier-local-embed-secret-32-chars") });
  const now = Math.floor(Date.now() / 1000);
  const token = tokens.sign({ typ: "aacp_embed_v1", merchantId: "m", nonce: "session-nonce", environment: "test",
    issuedAtUnix: now, expiresAtUnix: now + 120, allowedOrigin: "https://store.example.test", scopes: ["payment:intents:read"] });
  const guard = new EmbedAuthGuard(tokens, new Reflector());
  for (const handler of [CashbackEmbedController.prototype.reserve, CashbackEmbedController.prototype.remove]) {
    const request = { headers: { authorization: `Bearer ${token}`, origin: "https://store.example.test" } };
    const context = { getHandler: () => handler, getClass: () => CashbackEmbedController, switchToHttp: () => ({ getRequest: () => request }) };
    assert.throws(() => guard.canActivate(context as any), /^ForbiddenException: embed_scope_not_granted$/,
      "The server must reject a read-only payment token before wallet mutation");
  }
});
