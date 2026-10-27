import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const srcDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../src",
);

test("application composition registers only production adapters", () => {
  const appModule = readSource("app.module.ts");
  assert.doesNotMatch(
    appModule,
    /TestSeedModule|E2E_SEED_ENABLED|ScrapingAgentModule|SelfCheckoutModule|WidgetCrossSellController/,
  );

  const checkoutModule = readSource("modules/checkout/checkout.module.ts");
  const embedModule = readSource("modules/embed/embed.module.ts");
  assert.doesNotMatch(checkoutModule, /CrossSellModule/);
  assert.doesNotMatch(embedModule, /CrossSellModule|WidgetCrossSellController/);

  const paymentModule = readSource("modules/payment/payment.module.ts");
  assert.doesNotMatch(
    paymentModule,
    /FakePaymentProvider|process\.env|E2E_SEED_ENABLED/,
  );

  const negotiationModule = readSource(
    "modules/negotiation/negotiation.module.ts",
  );
  assert.doesNotMatch(
    negotiationModule,
    /InMemoryNegotiationStore|NEGOTIATION_REPOSITORY|process\.env/,
  );
});

function readSource(relativePath: string): string {
  return readFileSync(resolve(srcDir, relativePath), "utf8");
}
