import assert from "node:assert/strict";

/** Selects coverage only. Every mode still requires the same owned loopback DB,
 * marker/native-client checks, clean environment, egress fence and cleanup. */
export function parseNormalCheckoutPaymentNativeFlags(args) {
  const isolated = args.includes("--product-types-only") ? "product-types-only"
    : args.includes("--coupon-after-only") ? "coupon-after-only" : args.includes("--benefits-only") ? "benefits-only"
    : args.includes("--identity-only") ? "identity-only" : undefined;
  const expected = ["--local-disposable", "--prisma-loopback-exec", ...(isolated ? [`--${isolated}`] : [])];
  assert.deepEqual([...args].sort(), expected.sort(), "explicit_normal_payment_native_flags_required");
  return isolated ?? "baseline-and-identity";
}
