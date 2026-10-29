export const PURCHASE_HISTORY_STORAGE_MODE = Symbol("PURCHASE_HISTORY_STORAGE_MODE");

export interface PurchaseHistoryStorageMode {
  usesPrisma(): boolean;
}

export class DefaultPurchaseHistoryStorageMode implements PurchaseHistoryStorageMode {
  usesPrisma(): boolean {
    return true;
  }
}
