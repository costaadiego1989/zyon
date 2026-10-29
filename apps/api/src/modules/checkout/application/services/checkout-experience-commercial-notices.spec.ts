import test from "node:test";
import assert from "node:assert/strict";
import { buildExperienceFromSession } from "./checkout-experience.service.js";
import { checkoutSession } from "../../__tests__/checkout-test-fixtures.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";

test("checkout experience carries the canonical maximum-discount notice without financial changes", () => {
  const session = checkoutSession();
  session.cart.commercialNotices = [commercialNotice("discount_limit_reached")];
  const before = structuredClone(session);
  const experience = buildExperienceFromSession(session, {});
  assert.deepEqual(experience.commercial_notices, session.cart.commercialNotices);
  assert.deepEqual(session, before);
  assert.deepEqual(experience.totals, buildExperienceFromSession(checkoutSession(), {}).totals);
});
test("notice copy is projected from a validated code, never from arbitrary stored text", () => {
  const session = checkoutSession();
  session.cart.commercialNotices = [{ ...commercialNotice("discount_limit_reached"), message: "private diagnostic: coupon-secret" }];
  assert.deepEqual(buildExperienceFromSession(session, {}).commercial_notices, [commercialNotice("discount_limit_reached")]);
});
test("invalid notice groups fail closed and absent notices do not add a new wire property", () => {
  const session = checkoutSession();
  for (const invalid of [[{ version: 1, code: "invented", message: "x" }], Array(6).fill(commercialNotice("discount_limit_reached"))]) {
    Reflect.set(session.cart, "commercialNotices", invalid);
    assert.equal(Object.hasOwn(buildExperienceFromSession(session, {}), "commercial_notices"), false);
  }
  delete session.cart.commercialNotices;
  assert.equal(Object.hasOwn(buildExperienceFromSession(session, {}), "commercial_notices"), false);
});
