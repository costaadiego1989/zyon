import "./test-network-guard.mjs";
import "reflect-metadata";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import {
  readProspectingTestConfig,
  validateProspectingTestConfig,
} from "./prospecting-fixture.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const api = fileURLToPath(new URL("../", import.meta.url));
execFileSync(
  process.execPath,
  [
    "--max-old-space-size=4096",
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.build.json",
    "--incremental",
    "--tsBuildInfoFile",
    "node_modules/.cache/prospecting-root.tsbuildinfo",
  ],
  { cwd: api, stdio: "inherit", timeout: 600000 }
);
const compiled = (path: string) =>
  import(new URL("../dist/" + path + ".js", import.meta.url).href);
const { AppModule } = await compiled("app.module");
const { PaymentModule } = await compiled("modules/payment/payment.module");
const { HandleStripeWebhookUseCase } = await compiled(
  "modules/payment/application/handle-stripe-webhook.use-case"
);
const { AsaasBillingWebhookController } = await compiled(
  "modules/payment/presentation/http/asaas-billing-webhook.controller"
);
const { PROSPECTING_PORTS } = await compiled(
  "modules/platform-prospecting/domain/prospecting.ports"
);
const { PROSPECT_META_DISPATCH } = await compiled(
  "shared/integrations/prospect-meta-dispatch.port"
);
const { PROSPECTING_RUNTIME } = await compiled(
  "modules/platform-prospecting/platform-prospecting.module"
);
const { REDIS_CLIENT_TOKEN } = await compiled("shared/cache/redis.module");
const { SUBSCRIPTION_ATTRIBUTION } = await compiled(
  "modules/payment/domain/ports/subscription-attribution.port"
);
const cfg = readProspectingTestConfig();
validateProspectingTestConfig({
  ...cfg,
  databaseUrl: process.env.DATABASE_URL!,
});
assert.match(
  new URL(process.env.DATABASE_URL!).pathname,
  /^\/prospecting_test_[a-f0-9]{32}$/
);
assert.equal(process.env.REDIS_URL, cfg.redisUrl);
const app = await NestFactory.create(AppModule, {
  logger: false,
  abortOnError: false,
});
const runtime = app.get(PROSPECTING_RUNTIME);
try {
  const billing = app.get(PROSPECTING_PORTS.billing);
  assert.equal(app.get(SUBSCRIPTION_ATTRIBUTION), billing);
  const payment = app.select(PaymentModule);
  assert.equal(
    Reflect.get(
      payment.get(HandleStripeWebhookUseCase, { strict: true }),
      "attribution"
    ),
    billing
  );
  assert.equal(
    Reflect.get(
      payment.get(AsaasBillingWebhookController, { strict: true }),
      "attribution"
    ),
    billing
  );

  assert.equal(app.get(PROSPECT_META_DISPATCH), runtime.inbox);
  await app.listen(0, "127.0.0.1");
  assert.equal(await runtime.directory.activeSnapshotId(), "search-old");
  const deadline = Date.now() + 15000;
  while (
    !(await runtime.db.prospectRetentionRun.count()) &&
    Date.now() < deadline
  )
    await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(await runtime.db.prospectRetentionRun.count());
} finally {
  const redis = app.get(REDIS_CLIENT_TOKEN);
  await app.close();
  redis?.disconnect();
  assert.equal(runtime.status.config().workersRunning, false);
}
