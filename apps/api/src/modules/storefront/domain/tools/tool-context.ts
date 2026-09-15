export interface ToolRequestContext {
  merchantId: string;
  sessionId: string;
  conversationId?: string;
  buyer?: {
    globalUserId: string;
    name?: string;
    phone?: string;
    email?: string;
  };
  oneBuyClick?: {
    enabled: boolean;
    shippingPreference: "fastest" | "cheapest";
    paymentPreference: "pix" | "card";
  };
}
