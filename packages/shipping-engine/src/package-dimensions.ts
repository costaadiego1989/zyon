/**
 * Package Dimensions Validation for shipping carriers.
 * Based on Melhor Envio API constraints.
 */

import type { PackageDimensions } from "@zyon/shared-types";

export interface PackageValidationResult {
  valid: boolean;
  normalized?: PackageDimensions;
  reason?: string;
}

export interface PackageListValidationResult {
  valid: boolean;
  normalized?: PackageDimensions[];
  reason?: string;
}

/**
 * Melhor Envio limits (per official documentation).
 */
export const MELHOR_ENVIO_LIMITS = {
  minWeightKg: 0.1,
  maxWeightKg: 30,
  minDimensionCm: 1,
  maxDimensionCm: 300,
  maxLengthPlusDiameter: 400, // length + (2 × height) + (2 × width)
};

/**
 * Validate a single package dimension against Melhor Envio constraints.
 */
export function validatePackageDimensions(pkg: unknown): PackageValidationResult {
  if (!pkg || typeof pkg !== "object") {
    return { valid: false, reason: "package_not_object" };
  }

  const p = pkg as Record<string, unknown>;
  const weight = Number(p.weightKg);
  const height = Number(p.heightCm);
  const width = Number(p.widthCm);
  const length = Number(p.lengthCm);
  const quantity = Math.max(1, Math.floor(Number(p.quantity) || 1));

  // Check for NaN
  if (!Number.isFinite(weight)) return { valid: false, reason: "weight_invalid" };
  if (!Number.isFinite(height)) return { valid: false, reason: "height_invalid" };
  if (!Number.isFinite(width)) return { valid: false, reason: "width_invalid" };
  if (!Number.isFinite(length)) return { valid: false, reason: "length_invalid" };

  // Check bounds
  if (weight < MELHOR_ENVIO_LIMITS.minWeightKg) return { valid: false, reason: "weight_too_low" };
  if (weight > MELHOR_ENVIO_LIMITS.maxWeightKg) return { valid: false, reason: "weight_too_high" };

  if (height < MELHOR_ENVIO_LIMITS.minDimensionCm) return { valid: false, reason: "height_too_low" };
  if (height > MELHOR_ENVIO_LIMITS.maxDimensionCm) return { valid: false, reason: "height_too_high" };

  if (width < MELHOR_ENVIO_LIMITS.minDimensionCm) return { valid: false, reason: "width_too_low" };
  if (width > MELHOR_ENVIO_LIMITS.maxDimensionCm) return { valid: false, reason: "width_too_high" };

  if (length < MELHOR_ENVIO_LIMITS.minDimensionCm) return { valid: false, reason: "length_too_low" };
  if (length > MELHOR_ENVIO_LIMITS.maxDimensionCm) return { valid: false, reason: "length_too_high" };

  // Check combined dimension (length + 2*height + 2*width)
  const combinedDim = length + 2 * height + 2 * width;
  if (combinedDim > MELHOR_ENVIO_LIMITS.maxLengthPlusDiameter) {
    return { valid: false, reason: "dimensions_sum_too_large" };
  }

  const normalized: PackageDimensions = { weightKg: weight, heightCm: height, widthCm: width, lengthCm: length, quantity };
  return { valid: true, normalized };
}

/**
 * Validate an array of packages. All must be valid.
 */
export function validatePackagesList(packages: unknown): PackageListValidationResult {
  if (!Array.isArray(packages)) {
    return { valid: false, reason: "packages_not_array" };
  }

  if (packages.length === 0) {
    return { valid: false, reason: "packages_empty" };
  }

  const normalized: PackageDimensions[] = [];
  for (let i = 0; i < packages.length; i++) {
    const result = validatePackageDimensions(packages[i]);
    if (!result.valid) {
      return { valid: false, reason: `package_${i}:${result.reason}` };
    }
    normalized.push(result.normalized!);
  }

  return { valid: true, normalized };
}

/**
 * Type-safe wrapper that throws on invalid packages.
 */
export function assertValidPackages(packages: unknown): PackageDimensions[] {
  const result = validatePackagesList(packages);
  if (!result.valid) {
    throw new Error(result.reason || "invalid_packages");
  }
  return result.normalized!;
}
