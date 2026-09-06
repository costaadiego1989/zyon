/**
 * DI tokens for the cart-recovery module. Kept in a standalone file (not the
 * module) so infrastructure handlers can import them without creating a
 * circular dependency with cart-recovery.module.ts (which imports the handlers).
 * That cycle caused "Cannot access 'TRACK_RECOVERY_OUTCOME_USE_CASE' before
 * initialization" at boot.
 */
export const TRACK_RECOVERY_OUTCOME_USE_CASE = Symbol("TRACK_RECOVERY_OUTCOME_USE_CASE");
export const ATTEMPT_CART_RECOVERY_USE_CASE = Symbol("ATTEMPT_CART_RECOVERY_USE_CASE");
