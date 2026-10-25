/**
 * LGPD / data-export / data-deletion port for the buyer-account module.
 *
 * This port covers operations that span multiple tables (account + agent +
 * addresses + conversations + purchases + merchant lookup) and require
 * unsafe Prisma casts when bound directly to the relational schema. By
 * funnelling those operations through a typed boundary, the application
 * layer (use-cases) is kept free of `as unknown as` casts and Prisma
 * transaction handles.
 *
 * Implementations live in `infrastructure/`. The only production wiring is
 * the Prisma adapter; in-memory doubles are constructed in specs directly.
 *
 * LGPD semantics preserved:
 *   - Art. 18 V: subject access (data export) — deterministic JSON shape.
 *   - Art. 18 VI: deletion — atomic cascade inside a single transaction.
 *   - Art. 18 IX: anonymization — purchase rows keep totals/orders for
 *     merchant accounting/legal obligation but lose buyer identity.
 */
export const BUYER_ACCOUNT_PORT = Symbol("BUYER_ACCOUNT_PORT");

/** Profile snapshot for LGPD Art. 18 V (subject access / data portability). */
export interface BuyerAccountExportRow {
  globalUserId: string;
  email: string;
  displayName: string;
  phone: string | null;
  cpf: string | null;
  createdAt: Date;
}

/** Agent profile snapshot for LGPD Art. 18 V. */
export interface BuyerAgentProfileExportRow {
  name: string;
  personality: string;
  maxRounds: number;
  targetDiscountPercent: number;
  minimumAcceptableDiscountPercent: number;
  m2mEnabled: boolean;
}

/** Purchase record summary for LGPD Art. 18 V. */
export interface BuyerPurchaseExportRow {
  merchantId: string;
  orderId: string;
  totalAmount: number;
  currency: string;
  completedAt: Date;
  items: unknown;
}

export interface BuyerAccountPurchaseStatRow {
  merchantId: string;
  totalAmount: number;
  discountAmount: number;
}

/** Input for the LGPD Art. 18 VI cascade delete. */
export interface BuyerAccountCascadeDeleteInput {
  globalUserId: string;
}

export interface MerchantNameLookupRow {
  id: string;
  name: string;
}

export interface BuyerAccountPort {
  /**
   * Returns true when an account row exists for the given globalUserId.
   * Used to fail fast with `buyer_account_not_found` before destructive ops.
   */
  countAccountsByGlobalUserId(globalUserId: string): Promise<number>;

  /**
   * Atomic LGPD cascade: removes addresses, agent profile, conversations;
   * anonymizes purchase rows (keeps rows, nulls identity); finally removes
   * the account row. Runs in a single transaction so partial deletion is
   * impossible.
   */
  cascadeDelete(input: BuyerAccountCascadeDeleteInput): Promise<void>;

  /** LGPD Art. 18 V — subject profile snapshot. */
  findAccountForExport(globalUserId: string): Promise<BuyerAccountExportRow | null>;

  /** LGPD Art. 18 V — agent profile snapshot (or null when not configured). */
  findAgentForExport(globalUserId: string): Promise<BuyerAgentProfileExportRow | null>;

  /** LGPD Art. 18 V — purchase history snapshot, newest first. */
  listPurchasesForExport(globalUserId: string): Promise<BuyerPurchaseExportRow[]>;

  /**
   * Cheap projections used by the buyer summary aggregation. Only merchant
   * scopes are joined here; we never pull PII through this read path.
   */
  listPurchaseStatsForBuyer(globalUserId: string): Promise<BuyerAccountPurchaseStatRow[]>;

  /** Merchant id → display name lookup for summary top-N list. */
  listMerchantNames(ids: string[]): Promise<MerchantNameLookupRow[]>;
}
