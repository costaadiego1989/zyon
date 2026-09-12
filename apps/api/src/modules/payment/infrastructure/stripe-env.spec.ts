import assert from "node:assert/strict";
import test from "node:test";
import { readStripeBillingPortalConfiguration } from "./stripe-env.js";

test("non-production Stripe portal never reuses the live portal configuration", () => {
  const live = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION;
  const testConfiguration = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_TEST;
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION = "bpc_live_configuration";
  delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_TEST;
  try {
    assert.equal(readStripeBillingPortalConfiguration(), undefined);
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_TEST = "bpc_test_configuration";
    assert.equal(readStripeBillingPortalConfiguration(), "bpc_test_configuration");
  } finally {
    if (live === undefined) delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION;
    else process.env.STRIPE_BILLING_PORTAL_CONFIGURATION = live;
    if (testConfiguration === undefined) delete process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_TEST;
    else process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_TEST = testConfiguration;
  }
});
