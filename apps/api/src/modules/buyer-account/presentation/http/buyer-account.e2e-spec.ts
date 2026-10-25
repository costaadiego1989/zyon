import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";
import { BuyerJwtService } from "../../domain/services/buyer-jwt.service.js";
import { M2mTokenService } from "../../domain/services/m2m-token.service.js";
import { PrismaBuyerAccountRepository } from "../../infrastructure/prisma-buyer-account.repository.js";
import { PrismaBuyerAccountLgpdRepository } from "../../infrastructure/prisma-buyer-account-lgpd.repository.js";
import { RegisterBuyerUseCase } from "../../application/use-cases/register-buyer.use-case.js";
import { LoginBuyerUseCase } from "../../application/use-cases/login-buyer.use-case.js";
import { GetBuyerProfileUseCase } from "../../application/use-cases/get-buyer-profile.use-case.js";
import { UpdateBuyerProfileUseCase } from "../../application/use-cases/update-buyer-profile.use-case.js";
import { ChangeBuyerPasswordUseCase } from "../../application/use-cases/change-buyer-password.use-case.js";
import { UpsertBuyerAgentUseCase } from "../../application/use-cases/upsert-buyer-agent.use-case.js";
import { EnableM2mAgentUseCase } from "../../application/use-cases/enable-m2m-agent.use-case.js";
import { RevokeM2mAgentUseCase } from "../../application/use-cases/revoke-m2m-agent.use-case.js";
import { GetBuyerSummaryUseCase } from "../../application/use-cases/get-buyer-summary.use-case.js";
import { GetBuyerPurchasesUseCase } from "../../application/use-cases/get-buyer-purchases.use-case.js";
import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "Buyer account e2e: full journey — register, login, profile, agent, M2M, summary",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run buyer e2e tests." },
  async () => {
    const prisma = createPrismaClient();
    const repo = new PrismaBuyerAccountRepository(prisma);
    const lgpdPort = new PrismaBuyerAccountLgpdRepository(prisma);
    const hasher = new PasswordHasher();
    const jwt = new BuyerJwtService("test-secret", 3600);
    const m2m = new M2mTokenService();

    const register = new RegisterBuyerUseCase(repo, hasher, jwt);
    const login = new LoginBuyerUseCase(repo, hasher, jwt);
    const getProfile = new GetBuyerProfileUseCase(repo);
    const updateProfile = new UpdateBuyerProfileUseCase(repo);
    const changePassword = new ChangeBuyerPasswordUseCase(repo, hasher);
    const upsertAgent = new UpsertBuyerAgentUseCase(repo);
    const enableM2m = new EnableM2mAgentUseCase(repo, m2m);
    const revokeM2m = new RevokeM2mAgentUseCase(repo);
    const getPurchases = new GetBuyerPurchasesUseCase(prisma);
    const getSummary = new GetBuyerSummaryUseCase(repo, lgpdPort);

    const email = `buyer_e2e_${crypto.randomUUID()}@test.com`;
    let globalUserId: string;

    try {
      // Register
      const auth = await register.execute({ email, password: "password123", displayName: "Test Buyer" });
      globalUserId = auth.globalUserId;
      assert.ok(auth.accessToken.length > 0);
      assert.equal(auth.email, email);

      // Duplicate email → ConflictException
      await assert.rejects(
        () => register.execute({ email, password: "password123", displayName: "Dupe" }),
        ConflictException
      );

      // Login
      const loginAuth = await login.execute({ email, password: "password123" });
      assert.equal(loginAuth.globalUserId, globalUserId);

      // Wrong password → UnauthorizedException
      await assert.rejects(
        () => login.execute({ email, password: "wrongpass" }),
        UnauthorizedException
      );

      // JWT verification — buyer token valid
      const principal = jwt.verify(loginAuth.accessToken);
      assert.equal(principal.globalUserId, globalUserId);

      // Get profile
      const profile = await getProfile.execute(globalUserId);
      assert.equal(profile.displayName, "Test Buyer");
      assert.equal(profile.email, email);

      // Unknown globalUserId → NotFoundException
      await assert.rejects(
        () => getProfile.execute("nonexistent"),
        NotFoundException
      );

      // Update profile
      const updated = await updateProfile.execute({ globalUserId, displayName: "Updated Buyer", phone: "+5511999999999" });
      assert.equal(updated.displayName, "Updated Buyer");
      assert.equal(updated.phone, "+5511999999999");

      // Change password
      await changePassword.execute({ globalUserId, currentPassword: "password123", newPassword: "newpass456" });
      const relogin = await login.execute({ email, password: "newpass456" });
      assert.equal(relogin.globalUserId, globalUserId);

      // Wrong current password → UnauthorizedException
      await assert.rejects(
        () => changePassword.execute({ globalUserId, currentPassword: "wrongpass", newPassword: "newpass456" }),
        UnauthorizedException
      );

      // Purchase history (empty — no records linked to this test buyer)
      const purchases = await getPurchases.execute({ globalUserId });
      assert.equal(purchases.records.length, 0);
      assert.equal(purchases.nextCursor, null);

      // Create agent
      const agent = await upsertAgent.execute({
        globalUserId,
        name: "My Agent",
        personality: "balanced",
        maxRounds: 5,
        targetDiscountPercent: 20,
        minimumAcceptableDiscountPercent: 10,
      });
      assert.equal(agent.name, "My Agent");
      assert.equal(agent.m2mEnabled, false);
      assert.equal(agent.personality, "balanced");

      // Update agent (upsert)
      const agentUpdated = await upsertAgent.execute({
        globalUserId,
        name: "My Agent v2",
        personality: "aggressive",
        maxRounds: 3,
        targetDiscountPercent: 30,
        minimumAcceptableDiscountPercent: 15,
        autoAcceptThreshold: 25,
      });
      assert.equal(agentUpdated.name, "My Agent v2");
      assert.equal(agentUpdated.id, agent.id);

      // Enable M2M
      const { token } = await enableM2m.execute(globalUserId);
      assert.ok(token.startsWith("m2m_"));
      const agentAfterEnable = await repo.findAgentByGlobalUserId(globalUserId);
      assert.equal(agentAfterEnable?.m2mEnabled, true);
      assert.ok(agentAfterEnable?.m2mTokenHash);

      // Verify token hash lookup
      const m2mHash = m2m.hashToken(token);
      const agentByHash = await repo.findM2mByTokenHash(m2mHash);
      assert.equal(agentByHash?.globalUserId, globalUserId);

      // Re-enable regenerates token
      const { token: token2 } = await enableM2m.execute(globalUserId);
      assert.notEqual(token2, token);

      // Revoke M2M
      await revokeM2m.execute(globalUserId);
      const agentAfterRevoke = await repo.findAgentByGlobalUserId(globalUserId);
      assert.equal(agentAfterRevoke?.m2mEnabled, false);
      assert.equal(agentAfterRevoke?.m2mTokenHash, undefined);

      // Summary
      const summary = await getSummary.execute(globalUserId);
      assert.equal(summary.profile.globalUserId, globalUserId);
      assert.equal(summary.agent?.name, "My Agent v2");
      assert.equal(summary.stats.totalOrders, 0);
      assert.equal(summary.stats.totalSpent, 0);
    } finally {
      await prisma.buyerAgentProfile.deleteMany({ where: { globalUserId: globalUserId! } });
      await prisma.buyerAccount.deleteMany({ where: { globalUserId: globalUserId! } });
      await prisma.$disconnect();
    }
  }
);
