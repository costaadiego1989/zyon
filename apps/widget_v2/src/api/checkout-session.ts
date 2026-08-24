/**
 * CheckoutSession — API client for /embed/* endpoints.
 * Zero hardcoded data. All state comes from server.
 */

export interface CheckoutSessionConfig {
  embedToken: string;
  merchantId: string;
  cartRef?: string;
  apiBaseUrl: string;
  globalUserId?: string;
}

export interface BrandConfig {
  name?: string;
  subtitle?: string;
  logoUrl?: string;
  accentColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontDisplay?: string;
  borderColor?: string;
  borderRadius?: number;
  surfaceColor?: string;
  surfaceElevatedColor?: string;
  mutedTextColor?: string;
  successColor?: string;
  warningColor?: string;
  mode?: string;
  density?: string;
}

export interface AgentConfig {
  name?: string;
  greeting?: string;
}

export interface CartItem {
  sku: string;
  name: string;
  price: number;
  price_cents?: number;
  quantity: number;
  imageUrl?: string;
  category?: string;
  variant?: string;
}

export interface Experience {
  brand?: BrandConfig;
  agent?: AgentConfig;
  cart?: { items: CartItem[] };
  stage?: string;
}

export interface StartResponse {
  session_id: string;
  experience?: Experience;
}

export interface ChatBlock {
  type: string;
  data?: Record<string, unknown>;
  text?: string;
}

export interface ChatResponse {
  blocks: ChatBlock[];
  quick_replies?: string[];
}

export interface PaymentIntent {
  intent_id: string;
  method: string;
  status: string;
  pix_code?: string;
  pix_qr_url?: string;
  stripe_client_secret?: string;
  expires_at_unix?: number;
  amount_cents?: number;
}

export class CheckoutSession {
  private token: string;
  private merchantId: string;
  private cartRef: string | undefined;
  private baseUrl: string;
  private globalUserId: string | undefined;
  private sessionId: string | null = null;

  constructor(config: CheckoutSessionConfig) {
    this.token = config.embedToken;
    this.merchantId = config.merchantId;
    this.cartRef = config.cartRef;
    this.baseUrl = config.apiBaseUrl.replace(/\/$/, "");
    this.globalUserId = config.globalUserId;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get apiBaseUrl(): string {
    return this.baseUrl;
  }

  get authToken(): string {
    return this.token;
  }

  get currentMerchantId(): string {
    return this.merchantId;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async start(): Promise<StartResponse> {
    const res = await fetch(`${this.baseUrl}/embed/start`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        merchant_id: this.merchantId,
        cart_ref: this.cartRef || undefined,
        cart: { items: [] },
        customer_hints: this.globalUserId ? { externalCustomerId: this.globalUserId } : {},
        global_user_id: this.globalUserId || undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`embed_start_failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as StartResponse;
    this.sessionId = data.session_id;
    return data;
  }

  async fetchCart(): Promise<{ items: CartItem[]; total: number }> {
    if (!this.cartRef) return { items: [], total: 0 };
    const res = await fetch(
      `${this.baseUrl}/storefront/cart/${encodeURIComponent(this.cartRef)}?merchantId=${encodeURIComponent(this.merchantId)}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) return { items: [], total: 0 };
    const data = (await res.json()) as {
      items?: Array<{ variantId: string; productName: string; quantity: number; price: number; subtotal: number; imageUrl?: string }>;
      total?: number;
    };
    const items: CartItem[] = (data.items ?? []).map((i) => ({
      sku: i.variantId,
      name: i.productName,
      price: i.price,
      quantity: i.quantity,
      imageUrl: i.imageUrl,
    }));
    return { items, total: data.total ?? 0 };
  }

  async chat(message: string): Promise<ChatResponse> {
    this.assertSession();
    const res = await fetch(`${this.baseUrl}/embed/chat`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        session_id: this.sessionId,
        user_message: message,
        conversation_id: this.sessionId,
      }),
    });
    if (!res.ok) throw new Error(`embed_chat_failed: ${res.status}`);
    return res.json() as Promise<ChatResponse>;
  }

  async updateCartItemQty(variantId: string, quantity: number): Promise<unknown> {
    if (!this.cartRef) throw new Error("no_cart_ref");
    const res = await fetch(
      `${this.baseUrl}/storefront/cart/${encodeURIComponent(this.cartRef)}/items/${encodeURIComponent(variantId)}?merchantId=${encodeURIComponent(this.merchantId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      }
    );
    if (!res.ok) throw new Error(`cart_update_failed: ${res.status}`);
    return res.json();
  }

  async updateCart(items: Array<{ sku: string; quantity: number }>): Promise<unknown> {
    this.assertSession();
    const res = await fetch(`${this.baseUrl}/embed/cart`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, items }),
    });
    if (!res.ok) throw new Error(`embed_cart_failed: ${res.status}`);
    return res.json();
  }

  async fetchShippingQuote(destinationZip: string): Promise<Array<{ key: string; label: string; tag: string; sub: string; cost: number }>> {
    this.assertSession();
    const res = await fetch(`${this.baseUrl}/embed/shipping/quote`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        session_id: this.sessionId,
        destination_zip: destinationZip,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { options?: Array<{ carrier: string; method: string; deliveryDays?: number; customerPrice: number; carrierKey: string }> };
    return (data.options ?? []).map((o) => ({
      key: o.carrierKey,
      label: `${o.carrier} ${o.method}`.trim(),
      tag: o.deliveryDays ? `${o.deliveryDays} dias` : "A confirmar",
      sub: o.carrier,
      cost: Math.round(o.customerPrice * 100),
    }));
  }

  async selectShipping(key: string): Promise<unknown> {
    this.assertSession();
    const res = await fetch(`${this.baseUrl}/embed/shipping/select`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, shipping_key: key }),
    });
    if (!res.ok) throw new Error(`embed_shipping_failed: ${res.status}`);
    return res.json();
  }

  async createPaymentIntent(
    method: "pix" | "credito" | "debito" | "crypto",
    installments?: number
  ): Promise<PaymentIntent> {
    this.assertSession();
    // API expects: method = "pix" | "card" | "boleto" | "crypto"
    const apiMethod = method === "credito" || method === "debito" ? "card" : method;
    const idempotencyKey = `pay_${this.sessionId}_${apiMethod}_${Date.now()}`;
    const res = await fetch(`${this.baseUrl}/embed/payment/intents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        session_id: this.sessionId,
        idempotency_key: idempotencyKey,
        method: apiMethod,
        installments,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`embed_payment_failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<PaymentIntent>;
  }

  async getPaymentStatus(intentId: string): Promise<{ status: string; paid_at?: string }> {
    const res = await fetch(`${this.baseUrl}/embed/payment/intents/${intentId}/status`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`embed_payment_status_failed: ${res.status}`);
    return res.json() as Promise<{ status: string; paid_at?: string }>;
  }

  async applyOffer(offerId: string): Promise<unknown> {
    this.assertSession();
    const res = await fetch(`${this.baseUrl}/embed/offers/apply`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, offer_id: offerId }),
    });
    if (!res.ok) throw new Error(`embed_offer_failed: ${res.status}`);
    return res.json();
  }

  async updateCustomer(data: Record<string, unknown>): Promise<unknown> {
    this.assertSession();
    const res = await fetch(`${this.baseUrl}/embed/customer/update`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ session_id: this.sessionId, ...data }),
    });
    if (!res.ok) throw new Error(`embed_customer_failed: ${res.status}`);
    return res.json();
  }

  private assertSession(): void {
    if (!this.sessionId) throw new Error("session_not_started");
  }
}
