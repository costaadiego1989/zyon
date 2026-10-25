import "reflect-metadata";
import { NestFactory } from "@nestjs/core";

const databaseUrl = process.env.READY_PROD_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Composition check requires a disposable test database URL");
const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.pathname !== "/ready_prod_test") throw new Error("Only local ready_prod_test is allowed");
Object.assign(process.env, {
  NODE_ENV: "test", DATABASE_URL: databaseUrl, REDIS_URL: "", REDIS_ENABLED: "false",
  JWT_SECRET: "composition-fixture-jwt-secret-not-production",
  BUYER_JWT_SECRET: "composition-fixture-buyer-secret-not-production",
  EMBED_TOKEN_SECRET: "composition-fixture-embed-secret-not-production",
  AACP_PAYMENT_ENC_KEY: "a".repeat(64), AACP_PII_ENC_KEY: "b".repeat(64),
  AACP_COMMERCE_ENC_KEY: "c".repeat(64),
  OPENROUTER_API_KEY: "composition-fixture-no-external-provider",
  STRIPE_SECRET_KEY: "sk_test_fixture_not_a_real_provider_key",
  STRIPE_SECRET_KEY_TEST: "sk_test_fixture_not_a_real_provider_key",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_not_a_real_provider_key",
  RESEND_API_KEY: "", BUBBLEWHATS_API_URL: "", BUBBLEWHATS_TOKEN: "",
});
globalThis.fetch = async () => { throw new Error("external_http_disabled_in_composition_check"); };
let app;
try {
  const { AppModule } = await import(new URL("../../../.audit/verification/compiled/apps/api/src/app.module.js", import.meta.url));
  app = await NestFactory.create(AppModule, { abortOnError: false, logger: ["error", "warn"] });
  console.log("NEST_COMPOSITION_OK");
  await app.close();
  // This check covers dependency composition. It intentionally does not call
  // app.init/listen or claim to verify worker lifecycle or graceful shutdown.
  process.exit(0);
} catch (error) {
  console.error(error.stack);
  if (app) await app.close();
  process.exit(1);
}
