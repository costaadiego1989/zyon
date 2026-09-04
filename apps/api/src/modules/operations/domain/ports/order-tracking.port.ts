/**
 * M4 fix: Decouple order tracking from integrations module.
 * Operations defines the contract; integrations implements it.
 */
export const ORDER_TRACKING_UPDATER = Symbol("ORDER_TRACKING_UPDATER");

export interface UpdateOrderTrackingInput {
  merchantId: string;
  externalOrderId: string;
  body: {
    session_id?: string;
    tracking_code?: string;
    carrier?: string;
    tracking_url?: string;
    status?: string;
    events?: Array<{
      status?: string;
      description?: string;
      location?: string;
      occurred_at?: string;
      carrier_raw?: Record<string, unknown>;
    }>;
  };
}

export interface UpdateOrderTrackingResult {
  updated: boolean;
  changed: boolean;
  order: { trackingCode?: string };
  shipment: unknown;
  events_recorded: number;
}

export interface OrderTrackingUpdater {
  execute(input: UpdateOrderTrackingInput): Promise<UpdateOrderTrackingResult>;
}
