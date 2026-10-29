import type { StorefrontWriteAdmissionPort, StorefrontWriteAdmissionRequest, StorefrontWriteAdmissionResult } from "../../domain/ports/storefront-write-admission.port.js";
import type { StorefrontLocalCartEffectPort } from "../../domain/ports/storefront-local-cart-effect.port.js";
import {
  snapshotStorefrontWriteAdmissionRequest, snapshotStorefrontWriteMarkUnknownRequest,
  storefrontWriteAdmissionRequestSchema, storefrontWriteAdmissionResultSchema, storefrontWriteMarkUnknownResultSchema,
} from "../../domain/contracts/storefront-write-admission.schemas.js";
import { storefrontClaimedCartEffectRequestSchema, storefrontClaimedCartEffectResultSchema } from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { storefrontLocalCartExecutionResultSchema, type StorefrontLocalCartExecutionResult } from "../../domain/contracts/storefront-local-cart-execution.schemas.js";

/** Bounded internal orchestration, deliberately not wired into public flows.
 * Only a newly delivered valid claim enters the effect once. Errors/uncertain
 * acknowledgements never trigger replay, terminal rejection or lane release.
 * A later explicit invocation still requires durable admission, not a timer. */
export class ExecuteStorefrontLocalCartWrite {
  constructor(private readonly admission: StorefrontWriteAdmissionPort, private readonly effect: StorefrontLocalCartEffectPort) {}

  async execute(input: StorefrontWriteAdmissionRequest): Promise<StorefrontLocalCartExecutionResult> {
    // This private canonical snapshot (especially its mutable byte elements) is
    // never passed to a port. Each call gets a separately parsed/detached copy.
    const canonical = snapshotStorefrontWriteAdmissionRequest(input);
    const admission = this.admission, effect = this.effect;
    const admit = admission.admit, markUnknown = admission.markUnknown, execute = effect.execute;
    let admitted: StorefrontWriteAdmissionResult;
    try {
      admitted = storefrontWriteAdmissionResultSchema.parse(await admit.call(admission, storefrontWriteAdmissionRequestSchema.parse(canonical)));
    } catch {
      // No delivered valid claim: never invent a token or infer rollback.
      return storefrontLocalCartExecutionResultSchema.parse({ kind: "admission_unknown" });
    }
    if (admitted.kind !== "claimed") return storefrontLocalCartExecutionResultSchema.parse(admitted);

    // Parsing detached the claim from the admission implementation's object.
    // Freeze the private copy; the effect and transition receive other copies.
    const claim = Object.freeze(admitted.claim);
    try {
      const result = storefrontClaimedCartEffectResultSchema.parse(await execute.call(effect,
        storefrontClaimedCartEffectRequestSchema.parse({ ...canonical, claim })));
      if ((result.kind !== "effect_recorded" && result.kind !== "receipt_required")
        || result.requestId !== claim.requestId || result.revision !== canonical.intent.expected_revision + 1) {
        throw new Error("storefront_local_cart_effect_reference_unverified");
      }
      return storefrontLocalCartExecutionResultSchema.parse({ kind: "local_effect_recorded", requestId: result.requestId,
        effectId: result.effectId, revision: result.revision });
    } catch {
      try {
        storefrontWriteMarkUnknownResultSchema.parse(await markUnknown.call(admission,
          snapshotStorefrontWriteMarkUnknownRequest({ scope: canonical.scope, claim })));
      } catch {
        // Transition failure/not-current cannot justify replay or success.
        // No secret-bearing exception is rethrown, logged or returned.
      }
      return storefrontLocalCartExecutionResultSchema.parse({ kind: "outcome_unknown", requestId: claim.requestId });
    }
  }
}

