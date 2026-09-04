export interface StockAdjustedEvent {
  type: "stock.adjusted";
  merchantId: string;
  itemId: string;
  sku: string;
  previousQuantity: number;
  newQuantity: number;
  kind: string;
  source: string;
  timestamp: string;
}

export interface LowStockDetectedEvent {
  type: "stock.low_detected";
  merchantId: string;
  itemId: string;
  sku: string;
  available: number;
  threshold: number;
  timestamp: string;
}

export interface StockReservedEvent {
  type: "stock.reserved";
  merchantId: string;
  itemId: string;
  sku: string;
  quantity: number;
  externalRef?: string;
  timestamp: string;
}

export type InventoryDomainEvent =
  | StockAdjustedEvent
  | LowStockDetectedEvent
  | StockReservedEvent;
