export const STOREFRONT_CART_SNAPSHOT_CONFLICT = "storefront_cart_snapshot_conflict";

/** Authorization used stale persisted state; callers must not replay its write. */
export class StorefrontCartSnapshotConflictError extends Error {
  readonly code = STOREFRONT_CART_SNAPSHOT_CONFLICT;
  constructor() { super(STOREFRONT_CART_SNAPSHOT_CONFLICT); this.name = "StorefrontCartSnapshotConflictError"; }
}

