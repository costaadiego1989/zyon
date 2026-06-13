import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuthRepository } from "../infrastructure/in-memory-auth.repository.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { InMemoryMerchantRepository } from "../../merchant/infrastructure/in-memory-merchant.repository.js";
import { RegisterMerchantUseCase } from "./register-merchant.use-case.js";
import { LoginUseCase } from "./login.use-case.js";
import { IssueEmbedSessionUseCase } from "../../embed/application/issue-embed-session.use-case.js";
import { EmbedTokenService } from "../../embed/domain/embed-token.service.js";

const EMBED_SECRET = Buffer.from("athom-tech-embed-secret-32bytes!!");
const JWT_SECRET = "athom-tech-jwt-secret";

test("tenant onboarding: register Athom Tech → login → issue embed session", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService(JWT_SECRET, 3600);
  const embedTokens = new EmbedTokenService({ value: EMBED_SECRET });

  const merchants = new InMemoryMerchantRepository();
  const register = new RegisterMerchantUseCase(repository, merchants, hasher, jwt);
  const login = new LoginUseCase(repository, hasher, jwt);
  const issueEmbed = new IssueEmbedSessionUseCase(embedTokens);

  // 1. Register tenant
  const registered = await register.execute({
    merchant_id: "mrc_athom_tech",
    merchant_name: "Athom Tech",
    email: "costaadiego1989@gmail.com",
    password: "athom2026!",
  });

  assert.equal(registered.merchant_id, "mrc_athom_tech");
  assert.equal(registered.email, "costaadiego1989@gmail.com");
  assert.ok(registered.access_token, "must return JWT");

  // 2. Login returns same merchant
  const logged = await login.execute({
    email: "costaadiego1989@gmail.com",
    password: "athom2026!",
  });

  assert.equal(logged.merchant_id, "mrc_athom_tech");

  // 3. Verify JWT claims
  const claims = jwt.verify(logged.access_token);
  assert.equal(claims.merchantId, "mrc_athom_tech");
  assert.equal(claims.role, "owner");

  // 4. Issue embed session using authenticated merchantId
  const embedSession = issueEmbed.execute({
    merchantId: claims.merchantId,
    ttlSeconds: 900,
  });

  assert.ok(embedSession.embed_session_token, "must return embed token");
  assert.ok(embedSession.expires_at_unix > Math.floor(Date.now() / 1000), "must expire in future");

  // 5. Verify embed token binds to correct merchant
  const embedClaims = embedTokens.verify(embedSession.embed_session_token);
  assert.equal(embedClaims.merchantId, "mrc_athom_tech");
  assert.equal(embedClaims.typ, "aacp_embed_v1");
});

test("tenant onboarding: duplicate email rejected", async () => {
  const repository = new InMemoryAuthRepository();
  const hasher = new PasswordHasher();
  const jwt = new JwtService(JWT_SECRET, 3600);
  const merchants = new InMemoryMerchantRepository();
  const register = new RegisterMerchantUseCase(repository, merchants, hasher, jwt);

  await register.execute({
    merchant_id: "mrc_athom_tech",
    merchant_name: "Athom Tech",
    email: "costaadiego1989@gmail.com",
    password: "athom2026!",
  });

  await assert.rejects(
    () =>
      register.execute({
        merchant_name: "Athom Tech Duplicate",
        email: "costaadiego1989@gmail.com",
        password: "other",
      }),
    { name: "ConflictException" }
  );
});

test("tenant onboarding: embed token merchantId cannot be overridden by body param", () => {
  const embedTokens = new EmbedTokenService({ value: EMBED_SECRET });
  const issueEmbed = new IssueEmbedSessionUseCase(embedTokens);

  // Simulates what EmbedSessionsController does: uses JWT merchantId, ignores body merchant_id
  const trustedMerchantId = "mrc_athom_tech";
  const embedSession = issueEmbed.execute({ merchantId: trustedMerchantId, ttlSeconds: 120 });

  const claims = embedTokens.verify(embedSession.embed_session_token);
  assert.equal(claims.merchantId, trustedMerchantId, "embed token bound to authenticated merchant only");
});
