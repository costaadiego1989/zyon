/**
 * INFRASTRUCTURE LAYER — v2 Core
 *
 * This file is the FOUNDATION. It stays STABLE during incremental migration.
 * No breaking changes. Only additions.
 */

export type ApiKey = string;
export type EmbedToken = string;
export type MerchantId = string;

/** Environment-aware API configuration */
export const API_CONFIG = {
  v1: process.env.NEXT_PUBLIC_AACP_API_URL || "https://api.aacp.dev/v1",
  internal: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3009",
  /** Feature flag: use v1 for this resource? Defaults to false (use internal) */
  useV1: {
    products: process.env.NEXT_PUBLIC_USE_V1_PRODUCTS === "true",
    checkouts: process.env.NEXT_PUBLIC_USE_V1_CHECKOUTS === "true",
    settings: process.env.NEXT_PUBLIC_USE_V1_SETTINGS === "true",
    catalog: process.env.NEXT_PUBLIC_USE_V1_CATALOG === "true",
  },
};

/** RFC 7807 Error Response from v1 API */
export interface ProblemDetails {
  type: string; // "https://api.aacp.dev/errors/validation_error"
  title: string; // "Validation Error"
  status: number; // 422
  code: string; // "validation_error"
  detail?: string;
  correlation_id?: string;
  fields?: Record<string, string[]>;
}

/** V1 Response Envelope */
export interface ApiResponse<T> {
  data: T;
  meta: {
    request_id: string;
    timestamp: string;
    version: string;
  };
  pagination?: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

/** Unwrap v1 response envelope */
export function unwrapApiResponse<T>(response: ApiResponse<T>): T {
  return response.data;
}

/** Handle v1 API error */
export function isApiError(err: unknown): err is ProblemDetails {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    "code" in err &&
    "status" in err
  );
}

/** Safe HTTP client — no credentials exposed to client-side */
export async function apiProxyFetch(
  path: string,
  options?: RequestInit & { params?: Record<string, string> }
) {
  const url = new URL(path, window.location.origin);

  if (options?.params) {
    Object.entries(options.params).forEach(([k, v]) => {
      url.searchParams.append(k, v);
    });
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (isApiError(body)) {
      throw body; // ProblemDetails
    }
    throw new Error(`HTTP ${res.status}: ${body.detail || res.statusText}`);
  }

  return res.json();
}

/** Composable repository selector — safe to extend */
export type RepositoryFactory = {
  conversation: () => ConversationRepository;
  cart: () => CartRepository;
  catalog: () => CatalogRepository;
  settings: () => SettingsRepository;
  buyer: () => BuyerRepository;
};

// ─────────────────────────────────────────────────────────────
// PORT INTERFACES (Contracts)
// ─────────────────────────────────────────────────────────────

export interface ConversationRepository {
  create(input: { merchantId: string; customerId: string }): Promise<any>;
  sendMessage(input: { conversationId: string; text: string }): Promise<any>;
  getMessages(conversationId: string): Promise<any[]>;
}

export interface CartRepository {
  get(cartId: string): Promise<any>;
  updateItem(input: { cartId: string; variantId: string; quantity: number }): Promise<any>;
  clear(cartId: string): Promise<void>;
}

export interface CatalogRepository {
  listProducts(params?: { search?: string; limit?: number; cursor?: string }): Promise<any[]>;
  getProduct(id: string): Promise<any>;
}

export interface SettingsRepository {
  getCheckoutSettings(): Promise<any>;
  getStoreSettings(): Promise<any>;
}

export interface BuyerRepository {
  getProfile(): Promise<any>;
  getPurchaseHistory(): Promise<any[]>;
}
