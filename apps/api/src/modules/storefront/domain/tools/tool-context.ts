export interface ToolRequestContext {
  merchantId: string;
  sessionId: string;
  conversationId?: string;
  userMessage?: string;
  /** Server channel/executor only; never mapped from a DTO or tool argument. */
  existingLineForAdd?: import("../ports/storefront-cart.port.js").StorefrontExistingCartLine;
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
