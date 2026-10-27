import assert from "node:assert/strict";
import test from "node:test";
import { parseNormalCheckoutPaymentNativeFlags } from "./normal-checkout-payment.guards.mjs";

const base = ["--local-disposable", "--prisma-loopback-exec"];
test("normal native default preserves the full baseline/identity checkpoint", () => {
  assert.equal(parseNormalCheckoutPaymentNativeFlags(base), "baseline-and-identity");
  assert.equal(parseNormalCheckoutPaymentNativeFlags([...base].reverse()), "baseline-and-identity");
});
test("coupon-after-only is an explicitly labelled isolated checkpoint with the same owned resources", () => {
  const args = ["--coupon-after-only", ...base];
  assert.equal(parseNormalCheckoutPaymentNativeFlags(args), "coupon-after-only");
  assert.deepEqual(args, ["--coupon-after-only", ...base]);
});
test("benefits-only selects its own isolated checkpoint without broadening resource authority", () => {
  assert.equal(parseNormalCheckoutPaymentNativeFlags([...base, "--benefits-only"]), "benefits-only");
});
test("identity-only includes actual OTP and anonymous detachment with the same resource fence", () => {
  assert.equal(parseNormalCheckoutPaymentNativeFlags([...base, "--identity-only"]), "identity-only");
});
test("product-types-only selects real catalog/payment/order coverage with unchanged owned guards", () => {
  const args = ["--product-types-only", ...base];
  assert.equal(parseNormalCheckoutPaymentNativeFlags(args), "product-types-only");
  assert.deepEqual(args, ["--product-types-only", ...base]);
});
for (const args of [["--product-types-only"], [base[0], "--product-types-only"],
  [...base, "--product-types-only", "--product-types-only"],
  ...["--identity-only", "--benefits-only", "--coupon-after-only", "--allow-provider", "--production"]
    .map(flag => [...base, "--product-types-only", flag])])
  test("product-type coverage cannot combine modes, duplicate or broaden resource authority", () => {
    assert.throws(() => parseNormalCheckoutPaymentNativeFlags(args), /explicit_normal_payment_native_flags_required/);
  });
for (const args of [[...base, "--identity-only", "--coupon-after-only"], [...base, "--identity-only", "--benefits-only"], [...base, "--identity-only", "--identity-only"], ["--identity-only"]])
  test("identity mode cannot combine, duplicate or replace owned resource guards", () => {
    assert.throws(() => parseNormalCheckoutPaymentNativeFlags(args), /explicit_normal_payment_native_flags_required/);
  });
for (const args of [[...base, "--benefits-only", "--coupon-after-only"], [...base, "--benefits-only", "--benefits-only"], ["--benefits-only"]])
  test("benefit mode cannot combine, duplicate or replace owned resource guards", () => {
    assert.throws(() => parseNormalCheckoutPaymentNativeFlags(args), /explicit_normal_payment_native_flags_required/);
  });
for (const args of [[], [base[0]], [base[1]], ["--coupon-after-only"],
  [...base, "--coupon-after-only", "--coupon-after-only"], [...base, "--local-disposable"],
  [...base, "--production"], [...base, "--database-url=postgres://external.invalid/x"],
  [...base, "--coupon-after-only", "--allow-provider"], [...base, "--unknown"]])
  test("missing, duplicate or broader native flags fail closed", () => {
    assert.throws(() => parseNormalCheckoutPaymentNativeFlags(args), /explicit_normal_payment_native_flags_required/);
  });
