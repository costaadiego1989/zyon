import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutIdentityService } from "./checkout-identity.service.js";

test("CheckoutIdentityService normalizes hints and scopes them by merchant", () => {
  assert.equal(
    CheckoutIdentityService.identityKey("mrc_1", { email: " Buyer@Example.com " }),
    "mrc_1:buyer@example.com"
  );
  assert.equal(
    CheckoutIdentityService.identityKey("mrc_2", { email: " Buyer@Example.com " }),
    "mrc_2:buyer@example.com"
  );
});

test("CheckoutIdentityService prioritizes external customer id and returns undefined without hints", () => {
  assert.equal(
    CheckoutIdentityService.identityKey("mrc_1", {
      externalCustomerId: " EXT-1 ",
      email: "buyer@example.com"
    }),
    "mrc_1:ext-1"
  );
  assert.equal(CheckoutIdentityService.identityKey("mrc_1"), undefined);
});
