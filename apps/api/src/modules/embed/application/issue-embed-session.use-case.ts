import { Injectable } from "@nestjs/common";
import { EmbedTokenService, type EmbedTokenClaims } from "../domain/embed-token.service.js";

@Injectable()
export class IssueEmbedSessionUseCase {
  constructor(private readonly tokens: EmbedTokenService) {}

  execute(input: { merchantId: string; ttlSeconds: number }): {
    embed_session_token: string;
    expires_at_unix: number;
  } {
    const now = Math.floor(Date.now() / 1000);
    const expiresAtUnix = now + Math.min(Math.max(input.ttlSeconds, 60), 86400);

    const claims: EmbedTokenClaims = {
      typ: "aacp_embed_v1",
      merchantId: input.merchantId,
      issuedAtUnix: now,
      expiresAtUnix,
      nonce: crypto.randomUUID()
    };

    return {
      embed_session_token: this.tokens.sign(claims),
      expires_at_unix: expiresAtUnix
    };
  }
}
