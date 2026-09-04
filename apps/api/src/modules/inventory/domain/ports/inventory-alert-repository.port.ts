export const INVENTORY_ALERT_REPOSITORY = Symbol("INVENTORY_ALERT_REPOSITORY");

export interface AlertRow {
  id: string;
  merchantId: string;
  itemId: string;
  sku?: string;
  productName?: string;
  severity: string;
  message: string;
  acknowledged: boolean;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export interface InventoryAlertRepositoryPort {
  create(data: {
    merchantId: string;
    itemId: string;
    severity: string;
    message: string;
  }): Promise<AlertRow>;
  list(merchantId: string, acknowledged?: boolean): Promise<AlertRow[]>;
  acknowledge(merchantId: string, alertId: string): Promise<void>;
  existsOpen(merchantId: string, itemId: string, severity: string): Promise<boolean>;
}
