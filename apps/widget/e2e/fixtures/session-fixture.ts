/**
 * Session and cart fixtures for E2E checkout tests.
 * Provides deterministic test data with E2E_RUN_ID tracing.
 */
import type { Page } from "@playwright/test";
import { setupApiMocks, type MockApiOptions, type FlowStep, buildExperience, startCheckoutResponse } from "./api-mocks.js";

// ─── Session Fixture ─────────────────────────────────────────────────────────

const E2E_RUN_ID = `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export interface SessionFixture {
  runId: string;
  merchantId: string;
  sessionId: string;
  conversationId: string;
  globalUserId: string;
}

export function createSessionFixture(overrides?: Partial<SessionFixture>): SessionFixture {
  return {
    runId: E2E_RUN_ID,
    merchantId: overrides?.merchantId ?? "mrc_demo",
    sessionId: overrides?.sessionId ?? `sess_${E2E_RUN_ID}`,
    conversationId: overrides?.conversationId ?? `conv_${E2E_RUN_ID}`,
    globalUserId: overrides?.globalUserId ?? `guser_${E2E_RUN_ID}`,
  };
}

// ─── Cart Builder ────────────────────────────────────────────────────────────

export interface CartItem {
  sku: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  image_url: string;
  product_url: string;
  category: string;
  variant: string;
}

export interface CartFixture {
  items: CartItem[];
  currency: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
}

export function cartBuilder(): CartBuilder {
  return new CartBuilder();
}

class CartBuilder {
  private items: CartItem[] = [];
  private currency = "BRL";
  private shippingCost = 0;
  private discountAmount = 0;

  addItem(opts: Partial<CartItem> & { name: string; unit_price: number }): this {
    const qty = opts.quantity ?? 1;
    this.items.push({
      sku: opts.sku ?? `sku_${this.items.length + 1}`,
      name: opts.name,
      quantity: qty,
      unit_price: opts.unit_price,
      line_total: opts.unit_price * qty,
      image_url: opts.image_url ?? "https://images.unsplash.com/photo-placeholder?w=640",
      product_url: opts.product_url ?? `https://loja.example.com/${opts.name.toLowerCase().replace(/\s+/g, "-")}`,
      category: opts.category ?? "Geral",
      variant: opts.variant ?? "Padrão",
    });
    return this;
  }

  withShipping(cost: number): this {
    this.shippingCost = cost;
    return this;
  }

  withDiscount(amount: number): this {
    this.discountAmount = amount;
    return this;
  }

  build(): CartFixture {
    const subtotal = this.items.reduce((sum, i) => sum + i.line_total, 0);
    return {
      items: this.items,
      currency: this.currency,
      subtotal,
      shipping: this.shippingCost,
      discount: this.discountAmount,
      total: subtotal + this.shippingCost - this.discountAmount,
    };
  }

  /** Build as a CheckoutExperienceSnapshot-compatible totals+items */
  toExperienceOverrides() {
    const cart = this.build();
    return {
      items: cart.items,
      totals: {
        currency: cart.currency,
        subtotal: cart.subtotal,
        shipping: cart.shipping,
        discount: cart.discount,
        total: cart.total,
      },
    };
  }
}

// ─── Agent Responder (Mock LLM Sequence) ─────────────────────────────────────

export interface AgentResponderOptions {
  /** Pre-built flow sequence. Each chat call consumes the next step. */
  sequence: FlowStep[];
  /** Whether PIX payment returns approved immediately */
  pixInstantApproval?: boolean;
  /** Whether card payment returns approved immediately */
  cardInstantApproval?: boolean;
  /** Fail on N-th chat call to simulate network error */
  failOnChatCall?: number;
  /** Reject coupon application */
  rejectCoupon?: boolean;
}

export function agentResponder(opts: AgentResponderOptions): MockApiOptions {
  return {
    chatSequence: opts.sequence,
    pixInstantApproval: opts.pixInstantApproval,
    cardInstantApproval: opts.cardInstantApproval,
    failOnChatCall: opts.failOnChatCall,
    rejectCoupon: opts.rejectCoupon,
  };
}

// ─── Full Journey Helper ─────────────────────────────────────────────────────

/** Setup a full checkout journey with mocked API for the standard registration flow */
export async function setupFullJourneyMocks(
  page: Page,
  opts?: { extraSteps?: FlowStep[]; pixApproval?: boolean; cardApproval?: boolean },
) {
  const fullSequence: FlowStep[] = [
    "ask_email",
    "ask_cpf",
    "ask_phone",
    "ask_cep",
    "confirm_address",
    "ask_number",
    "show_shipping_options",
    "shipping_selected",
    ...(opts?.extraSteps ?? []),
  ];
  await setupApiMocks(page, {
    chatSequence: fullSequence,
    pixInstantApproval: opts?.pixApproval,
    cardInstantApproval: opts?.cardApproval,
    startResponse: startCheckoutResponse(buildExperience({
      stage: "data_collection",
      customer: { email: "buyer@e2e.test", email_verified: true },
    })),
  });
}

/** Install common test init scripts (disable streaming) */
export async function installTestInit(page: Page) {
  await page.addInitScript(() => {
    (globalThis as { process?: { env: Record<string, string> } }).process = {
      env: { AACP_DISABLE_STREAMING: "1" },
    };
  });
}
