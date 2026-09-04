import test from "node:test";
import assert from "node:assert/strict";
import { validatePackageDimensions, validatePackagesList, assertValidPackages, MELHOR_ENVIO_LIMITS } from "./package-dimensions.js";

const validPkg = { weightKg: 1, heightCm: 10, widthCm: 20, lengthCm: 30, quantity: 1 };

test("validatePackageDimensions accepts valid package", () => {
  const result = validatePackageDimensions(validPkg);
  assert.equal(result.valid, true);
  assert.deepEqual(result.normalized, validPkg);
});

test("validatePackageDimensions defaults quantity to 1 if missing", () => {
  const result = validatePackageDimensions({ weightKg: 1, heightCm: 10, widthCm: 20, lengthCm: 30 });
  assert.equal(result.valid, true);
  const pkg = result.normalized as any;
  assert.equal(pkg.quantity, 1);
});

test("validatePackageDimensions rounds quantity down", () => {
  const result = validatePackageDimensions({ weightKg: 1, heightCm: 10, widthCm: 20, lengthCm: 30, quantity: 2.7 });
  assert.equal(result.valid, true);
  assert.equal((result.normalized as any).quantity, 2);
});

test("validatePackageDimensions rejects non-object", () => {
  assert.deepEqual(validatePackageDimensions(null), { valid: false, reason: "package_not_object" });
  assert.deepEqual(validatePackageDimensions("pkg"), { valid: false, reason: "package_not_object" });
});

test("validatePackageDimensions rejects weight too low", () => {
  const result = validatePackageDimensions({ ...validPkg, weightKg: 0.05 });
  assert.deepEqual(result, { valid: false, reason: "weight_too_low" });
});

test("validatePackageDimensions rejects weight too high", () => {
  const result = validatePackageDimensions({ ...validPkg, weightKg: 31 });
  assert.deepEqual(result, { valid: false, reason: "weight_too_high" });
});

test("validatePackageDimensions rejects invalid weight (NaN)", () => {
  const result = validatePackageDimensions({ ...validPkg, weightKg: "abc" });
  assert.deepEqual(result, { valid: false, reason: "weight_invalid" });
});

test("validatePackageDimensions rejects dimensions outside min", () => {
  assert.deepEqual(
    validatePackageDimensions({ ...validPkg, heightCm: 0 }),
    { valid: false, reason: "height_too_low" }
  );
  assert.deepEqual(
    validatePackageDimensions({ ...validPkg, widthCm: -5 }),
    { valid: false, reason: "width_too_low" }
  );
});

test("validatePackageDimensions rejects dimensions outside max", () => {
  assert.deepEqual(
    validatePackageDimensions({ ...validPkg, heightCm: 301 }),
    { valid: false, reason: "height_too_high" }
  );
});

test("validatePackageDimensions rejects combined dimension sum too large", () => {
  // length + 2*height + 2*width must be <= 400
  // 100 + 2*100 + 2*100 = 500 > 400
  const result = validatePackageDimensions({ weightKg: 1, heightCm: 100, widthCm: 100, lengthCm: 100, quantity: 1 });
  assert.deepEqual(result, { valid: false, reason: "dimensions_sum_too_large" });
});

test("validatePackagesList rejects non-array", () => {
  assert.deepEqual(validatePackagesList(null), { valid: false, reason: "packages_not_array" });
  assert.deepEqual(validatePackagesList(validPkg), { valid: false, reason: "packages_not_array" });
});

test("validatePackagesList rejects empty array", () => {
  assert.deepEqual(validatePackagesList([]), { valid: false, reason: "packages_empty" });
});

test("validatePackagesList accepts single valid package", () => {
  const result = validatePackagesList([validPkg]);
  assert.equal(result.valid, true);
  assert.equal((result.normalized as any[]).length, 1);
});

test("validatePackagesList accepts multiple valid packages", () => {
  const result = validatePackagesList([validPkg, { ...validPkg, quantity: 2 }]);
  assert.equal(result.valid, true);
  assert.equal((result.normalized as any[]).length, 2);
});

test("validatePackagesList rejects if any package invalid", () => {
  const result = validatePackagesList([
    validPkg,
    { ...validPkg, weightKg: -5 } // invalid
  ]);
  assert.deepEqual(result, { valid: false, reason: "package_1:weight_too_low" });
});

test("assertValidPackages returns array or throws", () => {
  const result = assertValidPackages([validPkg]);
  assert.deepEqual(result, [validPkg]);

  assert.throws(() => assertValidPackages([]), /packages_empty/);
});
