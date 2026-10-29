import type { Prisma, PrismaClient } from "@prisma/client";
import type { StorefrontCartPort } from "../../domain/ports/storefront-cart.port.js";
import { storefrontWriteScopeSchema } from "../../domain/contracts/storefront-local-cart-write.schemas.js";
import { StorefrontCartRepositoryCore } from "./prisma-storefront-cart.repository.js";
import {
  lockStorefrontCart, withStorefrontCartInTransaction,
  type StorefrontCartTransactionWork, type StorefrontCartTransactionResult, type StorefrontCartAccess, type StorefrontCombinedCouponRevalidator, type StorefrontCombinedCouponLifecycle,
} from "./storefront-cart-transaction.js";
import { storefrontCartHasCheckoutBinding, assertStorefrontCartUnbound } from "./storefront-checkout-binding-fence.js";

const scopeSchema = storefrontWriteScopeSchema.pick({ merchantId: true, cartId: true });
type CartScope = { merchantId: string; cartId: string };

class TransactionCartRepository extends StorefrontCartRepositoryCore {
  constructor(private readonly tx: Prisma.TransactionClient, private readonly revalidateCoupon?: StorefrontCombinedCouponRevalidator,
    private readonly couponLifecycle?: StorefrontCombinedCouponLifecycle) { super(); }

  protected withCart<T>(merchantId: string, sessionId: string, work: StorefrontCartTransactionWork<T>, access?: StorefrontCartAccess): Promise<StorefrontCartTransactionResult<T | void>> {
    return withStorefrontCartInTransaction(this.tx, merchantId, sessionId, work, access, this.revalidateCoupon, this.couponLifecycle);
  }
}

/** Tracks the public operation promise, not just its inner SQL runner. */
class CartLease {
  private open = true;
  private pending?: Promise<unknown>;
  private failure?: { error: unknown };
  readonly cart: StorefrontCartPort;

  constructor(private readonly scope: CartScope, tx: Prisma.TransactionClient, revalidateCoupon?: StorefrontCombinedCouponRevalidator,
    couponLifecycle?: StorefrontCombinedCouponLifecycle) {
    const repository = new TransactionCartRepository(tx, revalidateCoupon, couponLifecycle);
    this.cart = Object.freeze({
      getOrCreate: (merchantId: string, sessionId: string) => this.invoke(merchantId, sessionId, () => repository.getOrCreate(merchantId, sessionId)),
      addItem: (merchantId: string, sessionId: string, item: Parameters<StorefrontCartPort["addItem"]>[2]) => this.invoke(merchantId, sessionId, () => repository.addItem(merchantId, sessionId, item)),
      removeItem: (merchantId: string, sessionId: string, variantId: string, selector?: Parameters<StorefrontCartPort["removeItem"]>[3]) => this.invoke(merchantId, sessionId, () => repository.removeItem(merchantId, sessionId, variantId, selector)),
      updateItemQuantity: (merchantId: string, sessionId: string, variantId: string, quantity: number, selector?: Parameters<StorefrontCartPort["updateItemQuantity"]>[4]) => this.invoke(merchantId, sessionId, () => repository.updateItemQuantity(merchantId, sessionId, variantId, quantity, selector)),
      clear: (merchantId: string, sessionId: string) => this.invoke(merchantId, sessionId, () => repository.clear(merchantId, sessionId)),
      applyCoupon: (merchantId: string, sessionId: string, code: string, discount: number, expectedCart?: Parameters<StorefrontCartPort["applyCoupon"]>[4]) => this.invoke(merchantId, sessionId, () => repository.applyCoupon(merchantId, sessionId, code, discount, expectedCart)),
      removeCoupon: (merchantId: string, sessionId: string) => this.invoke(merchantId, sessionId, () => repository.removeCoupon(merchantId, sessionId)),
      applyRuleOutcome: (merchantId: string, sessionId: string, outcome: Parameters<StorefrontCartPort["applyRuleOutcome"]>[2], expectedCart?: Parameters<StorefrontCartPort["applyRuleOutcome"]>[3]) => this.invoke(merchantId, sessionId, () => repository.applyRuleOutcome(merchantId, sessionId, outcome, expectedCart)),
    });
  }

  private invoke<T>(merchantId: string, sessionId: string, work: () => Promise<T>): Promise<T> {
    if (!this.open) return this.reject("storefront_cart_uow_closed");
    if (merchantId !== this.scope.merchantId || sessionId !== this.scope.cartId) return this.reject("storefront_cart_uow_scope_mismatch");
    if (this.pending) return this.reject("storefront_cart_uow_operation_in_progress");
    const operation = work();
    this.pending = operation;
    const clear = () => { if (this.pending === operation) this.pending = undefined; };
    void operation.then(clear, error => { this.failure ??= { error }; clear(); });
    return operation;
  }

  private reject<T>(code: string): Promise<T> {
    const error = new Error(code);
    if (this.open) this.failure ??= { error };
    const rejected = Promise.reject<T>(error);
    // An ignored rejected call must not become an unhandled process rejection.
    void rejected.catch(() => {});
    return rejected;
  }

  async close(): Promise<void> {
    this.open = false;
    const outstanding = this.pending;
    if (outstanding) await outstanding.catch(() => {});
    // Catch/fallback inside the callback cannot turn a failed required cart
    // operation into a successful partial commit, even if it already settled.
    if (this.failure) throw this.failure.error;
    if (outstanding) throw new Error("storefront_cart_uow_operation_not_awaited");
  }
}

export interface StorefrontCartTransactionContext {
  readonly cart: StorefrontCartPort;
  readonly tx: Prisma.TransactionClient;
}
/** Trusted infrastructure composition; not accepted from DTOs. Pre-lock hook
 * must acquire earlier merchant/config fences before this UOW owns the cart. */
export interface StorefrontCartTransactionComposition {
  beforeCartLock?: (tx: Prisma.TransactionClient) => Promise<void>;
  revalidateCoupon?: StorefrontCombinedCouponRevalidator;
  couponLifecycle?: StorefrontCombinedCouponLifecycle;
}

/** Isolated infrastructure foundation; NOT wired into application/public flows.
 * Only work using the supplied tx/cart is enlisted. Captured clients or external
 * effects cannot be made atomic by this API. No claims, evidence policy, rules
 * orchestration or command idempotency are implemented here. The cart-side
 * binding guard is a prerequisite only, not authoritative handoff. */
export class PrismaStorefrontCartUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async run<T>(input: CartScope, work: (context: StorefrontCartTransactionContext) => Promise<T>, composition?: StorefrontCartTransactionComposition): Promise<T> {
    const scope = Object.freeze(scopeSchema.parse(input));
    if (typeof work !== "function") throw new Error("storefront_cart_uow_work_required");
    const beforeCartLock = composition?.beforeCartLock, revalidateCoupon = composition?.revalidateCoupon, couponLifecycle = composition?.couponLifecycle;
    return this.prisma.$transaction(async tx => {
      if (beforeCartLock) await beforeCartLock(tx);
      await lockStorefrontCart(tx, scope.merchantId, scope.cartId);
      assertStorefrontCartUnbound(await storefrontCartHasCheckoutBinding(tx, scope.merchantId, scope.cartId));
      const lease = new CartLease(scope, tx, revalidateCoupon, couponLifecycle);
      let outcome: { success: true; value: T } | { success: false; error: unknown };
      try { outcome = { success: true, value: await work(Object.freeze({ cart: lease.cart, tx })) }; }
      catch (error) { outcome = { success: false, error }; }
      try { await lease.close(); }
      catch (error) { if (outcome.success) outcome = { success: false, error }; }
      if (!outcome.success) throw outcome.error;
      return outcome.value;
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
  }
}

