export const SHIPPING_CARRIER_ADAPTER = Symbol("SHIPPING_CARRIER_ADAPTER");

export interface LabelPurchaseInput {
  serviceId: number;
  fromZip: string;
  toZip: string;
  toName: string;
  toDocument: string;
  packages: Array<{ weightKg: number; widthCm: number; heightCm: number; lengthCm: number; quantity: number }>;
  invoiceKey?: string;
  fromName?: string;
  fromDocument?: string;
}

export interface LabelPurchaseResult {
  purchaseId: string;
  trackingCode: string;
  labelUrl?: string;
}

export interface TrackingResult {
  status: string;
  events: Array<{ status: string; date: string; description: string }>;
}

export interface ShippingCarrierPort {
  purchaseLabel(input: LabelPurchaseInput): Promise<LabelPurchaseResult>;
  getTracking(trackingCode: string): Promise<TrackingResult>;
}
