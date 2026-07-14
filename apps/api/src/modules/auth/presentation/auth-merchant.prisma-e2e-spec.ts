import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { JwtService } from "../domain/services/jwt.service.js";
import { PasswordHasher } from "../domain/services/password-hasher.service.js";
import { DefaultMerchantIdGenerator } from "../domain/ports/merchant-id-generator.port.js";
import { PrismaAuthRepository } from "../infrastructure/prisma-auth.repository.js";
import { LoginUseCase } from "../application/login.use-case.js";
import { RegisterMerchantUseCase } from "../application/register-merchant.use-case.js";
import { PrismaMerchantRepository } from "../../merchant/infrastructure/prisma-merchant.repository.js";
import { GetMerchantProfileUseCase, GetMerchantRulesUseCase, UpdateMerchantRulesUseCase } from "../../merchant/application/merchant.use-cases.js";
import { GetMerchantThemeUseCase } from "../../merchant/application/get-merchant-theme.use-case.js";
import { UpdateMerchantThemeUseCase } from "../../merchant/application/update-merchant-theme.use-case.js";
import { MerchantController } from "../../merchant/presentation/merchant.controller.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "Prisma auth and merchant e2e registers, logs in, and manages protected merchant rules",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma auth/merchant e2e tests." },
  async () => {
    const prisma = createPrismaClient();
    const authRepository = new PrismaAuthRepository(prisma);
    const merchantRepository = new PrismaMerchantRepository(prisma);
    const jwt = new JwtService("test-secret", 3600);
    const hasher = new PasswordHasher();
    const idGen = new DefaultMerchantIdGenerator();
    const register = new RegisterMerchantUseCase(authRepository, hasher, jwt, idGen);
    const login = new LoginUseCase(authRepository, hasher, jwt);
    const merchantController = new MerchantController(
      new GetMerchantProfileUseCase(merchantRepository),
      new GetMerchantRulesUseCase(merchantRepository),
      new UpdateMerchantRulesUseCase(merchantRepository),
      new GetMerchantThemeUseCase(merchantRepository),
      new UpdateMerchantThemeUseCase(merchantRepository)
    );
    const email = `mrc_auth_${crypto.randomUUID()}@example.com`;
    let merchantId = "";

    try {
      const registered = await register.execute({
        merchant_name: "Auth Demo",
        email,
        password: "secret-password-123"
      });
      merchantId = registered.merchant_id;

      const logged = await login.execute({ email, password: "secret-password-123" });
      const principal = jwt.verify(logged.access_token);
      const request = { user: principal };

      assert.equal(registered.merchant_id, merchantId);
      assert.equal(principal.merchantId, merchantId);
      assert.equal((await merchantController.profile(request)).name, "Auth Demo");
      assert.equal((await merchantController.update(request, { maxDiscountPercent: 17 })).maxDiscountPercent, 17);
      assert.equal((await merchantController.rules(request)).maxDiscountPercent, 17);
    } finally {
      if (merchantId) {
        await prisma.merchantRule.deleteMany({ where: { merchantId } });
        await prisma.merchantUser.deleteMany({ where: { merchantId } });
        await prisma.merchant.deleteMany({ where: { id: merchantId } });
      }
      await prisma.$disconnect();
    }
  }
);
