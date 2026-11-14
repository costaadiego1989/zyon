export type BusinessMode = "products" | "services";
export type ServicePaymentMode = "online" | "at_attendance";

export class ServiceBusinessPolicyError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export interface ServicePolicyConfiguration {
  holdEnabled: boolean;
  holdMinutes: number | null;
  paymentMode: ServicePaymentMode;
}

export interface ServiceBusinessPolicyInput {
  businessMode: BusinessMode;
  businessModeSelectedAt: Date | null;
  businessModeNeedsReview: boolean;
  /** Canonical reader supplies evidence from legacy service offers/reservations. */
  hasLegacyServiceData: boolean;
  policy: {
    admissionsEnabled: boolean;
    holdEnabled: boolean | null;
    holdMinutes: number | null;
    paymentMode: ServicePaymentMode | null;
    version: number;
    configuredAt: Date | null;
  } | null;
}

export function parseBusinessMode(value: unknown): BusinessMode {
  if (value !== "products" && value !== "services")
    throw new ServiceBusinessPolicyError("business_mode_required");
  return value;
}

export function validateServicePolicyConfiguration(value: unknown): ServicePolicyConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ServiceBusinessPolicyError("service_policy_required");
  const input = value as Record<string, unknown>;
  if (typeof input.holdEnabled !== "boolean")
    throw new ServiceBusinessPolicyError("service_policy_hold_choice_required");
  if (input.paymentMode !== "online" && input.paymentMode !== "at_attendance")
    throw new ServiceBusinessPolicyError("service_policy_payment_choice_required");
  if (input.holdEnabled && (typeof input.holdMinutes !== "number" || !Number.isInteger(input.holdMinutes)
    || input.holdMinutes <= 0 || input.holdMinutes > 2_147_483_647))
    throw new ServiceBusinessPolicyError("service_policy_hold_minutes_required");
  return {
    holdEnabled: input.holdEnabled,
    holdMinutes: input.holdEnabled ? input.holdMinutes as number : null,
    paymentMode: input.paymentMode,
  };
}

export function resolveServiceBusinessPolicy(input: ServiceBusinessPolicyInput) {
  const businessMode = parseBusinessMode(input.businessMode);
  const needsReview = input.businessModeNeedsReview || (!input.businessModeSelectedAt && (input.hasLegacyServiceData || businessMode === "services"));
  const selectionState = needsReview ? "review_required" : input.businessModeSelectedAt ? "selected" : "legacy";
  let policyStatus: "unconfigured" | "configured" | "invalid" = "unconfigured";
  let policy: ServicePolicyConfiguration | null = null;
  let policyVersion: number | null = null;
  if (input.policy?.configuredAt) {
    try {
      if (!Number.isFinite(input.policy.configuredAt.getTime()) || !Number.isInteger(input.policy.version) || input.policy.version < 1)
        throw new ServiceBusinessPolicyError("service_policy_invalid_version");
      policy = validateServicePolicyConfiguration(input.policy);
      policyVersion = input.policy.version;
      policyStatus = "configured";
    } catch (error) {
      if (!(error instanceof ServiceBusinessPolicyError)) throw error;
      policyStatus = "invalid";
    }
  }
  const bookingBlockReason = needsReview ? "classification_required" : businessMode === "products" ? "products_mode"
    : policyStatus === "unconfigured" ? "policy_not_configured" : policyStatus === "invalid" ? "policy_invalid"
      : input.policy?.admissionsEnabled !== true ? "admissions_disabled" : null;
  return {
    businessMode, selectionState, policyStatus, policyVersion, policy, bookingBlockReason,
    capabilities: {
      products: businessMode === "products",
      serviceAdministration: businessMode === "services" && !needsReview,
      serviceBooking: bookingBlockReason === null,
      // Reconciliation still has its own canonical payment/ownership guards.
      reconcileExisting: true,
    },
  };
}

export function assertCompatibleBusinessModeChange(next: BusinessMode, facts: {
  activeProductOffers: number;
  activeServiceOffers: number;
  ongoingAppointments: number;
}): void {
  parseBusinessMode(next);
  if (Object.values(facts).some(count => !Number.isSafeInteger(count) || count < 0))
    throw new ServiceBusinessPolicyError("business_mode_invalid_facts");
  if (next === "services" ? facts.activeProductOffers > 0 : facts.activeServiceOffers > 0 || facts.ongoingAppointments > 0)
    throw new ServiceBusinessPolicyError("business_mode_conflict");
}
