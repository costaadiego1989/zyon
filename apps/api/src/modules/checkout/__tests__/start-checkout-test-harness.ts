import type { Cart } from "@zyon/shared-types";
import { StartCheckoutUseCase } from "../application/use-cases/start-checkout.use-case.js";

/**
 * Orchestration fixtures model a successful catalog lookup. Tests that exercise
 * the public price boundary use the production service in checkout-trust-boundary.spec.ts.
 * Identity assertions and freight from the fixture request still pass through
 * the production input policy; this helper cannot pre-verify a customer.
 */
export class StartCheckoutTestHarness extends StartCheckoutUseCase {
  constructor(...args: ConstructorParameters<typeof StartCheckoutUseCase>) {
    args[10] ??= {
      async resolve(_merchantId: string, fixture: Cart): Promise<Cart> {
        return structuredClone(fixture);
      },
    } as never;
    super(...args);
  }
}
