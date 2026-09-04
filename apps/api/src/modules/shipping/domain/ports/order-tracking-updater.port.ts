export const ORDER_TRACKING_UPDATER = Symbol("ORDER_TRACKING_UPDATER");

export type OrderTrackingUpdateInput = {
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
};

export type OrderTrackingUpdater = {
  execute(input: OrderTrackingUpdateInput): Promise<unknown>;
};
