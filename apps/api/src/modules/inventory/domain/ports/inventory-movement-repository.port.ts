export const INVENTORY_MOVEMENT_REPOSITORY = Symbol("INVENTORY_MOVEMENT_REPOSITORY");

export interface MovementRow {
  id: string;
  merchantId: string;
  itemId: string;
  sku?: string;
  productName?: string;
  kind: string;
  quantity: number;
  reason: string | null;
  externalRef: string | null;
  source: string;
  actorUserId: string | null;
  createdAt: Date;
}

export interface MovementListFilter {
  merchantId: string;
  itemId?: string;
  kind?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface InventoryMovementRepositoryPort {
  record(data: {
    merchantId: string;
    itemId: string;
    kind: string;
    quantity: number;
    reason?: string;
    externalRef?: string;
    source?: string;
    actorUserId?: string;
  }): Promise<MovementRow>;
  list(filter: MovementListFilter): Promise<{ movements: MovementRow[]; total: number }>;
}
