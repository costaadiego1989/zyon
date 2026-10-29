import { Module } from "@nestjs/common";
import { TestSeedController } from "./test-seed.controller.js";
import { AuthModule } from "../auth/auth.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PaymentModule } from "../payment/payment.module.js";
import { PasswordHasher } from "../auth/domain/services/password-hasher.service.js";

if (process.env.NODE_ENV === "production" && process.env.E2E_SEED_ENABLED === "true") {
  throw new Error("E2E_SEED_ENABLED must not be set in production — aborting startup");
}

@Module({
  imports: [AuthModule, MerchantModule, PaymentModule],
  controllers: [TestSeedController],
  providers: [PasswordHasher]
})
export class TestSeedModule {}
