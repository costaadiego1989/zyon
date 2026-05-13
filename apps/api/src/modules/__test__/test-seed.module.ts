import { Module } from "@nestjs/common";
import { TestSeedController } from "./test-seed.controller.js";

if (process.env.NODE_ENV === "production" && process.env.E2E_SEED_ENABLED === "true") {
  throw new Error("E2E_SEED_ENABLED must not be set in production — aborting startup");
}

@Module({ controllers: [TestSeedController] })
export class TestSeedModule {}
