"use client";

import { useCallback, useState } from "react";

// Federated marketplace uses internal endpoint — no v1 equivalent yet.
// Keeps V1 behavior unchanged. When marketplace has v1 endpoints, add flag here.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

export interface FederatedProduct {
  id: string;
  name: string;
  price: number;
  priceFormatted: string;
  image?: string;
  sellerName: string;
  sellerId: string;
  inStock: boolean;
  category?: string;
  description?: string;
}

export interface MarketplaceSearchResult {
  products: FederatedProduct[];
}

export interface AddToCartResult {
  success: boolean;
  lineItemId?: string;
  message: string;
}

export function useMarketplaceSearch() {
  const [results, setResults] = useState<FederatedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(
    async (merchantId: string, query: string, category?: string, limit: number = 10) => {
      if (!query.trim() || !merchantId) {
        setResults([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          query,
          merchantId,
          limit: limit.toString(),
        });

        if (category) {
          params.append("category", category);
        }

        const response = await fetch(
          `${API_BASE}/storefront/marketplace/search?${params.toString()}`,
          {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          setError(`Search failed: ${response.status}`);
          setResults([]);
          return;
        }

        const data = (await response.json()) as MarketplaceSearchResult;
        setResults(data.products ?? []);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const addToCart = useCallback(
    async (
      sessionId: string,
      merchantId: string,
      product: FederatedProduct,
      quantity: number = 1
    ): Promise<AddToCartResult> => {
      try {
        const response = await fetch(`${API_BASE}/storefront/marketplace/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_id: merchantId,
            session_id: sessionId,
            seller_merchant_id: product.sellerId,
            federated_product_id: product.id,
            quantity,
            unit_price_cents: Math.round(product.price * 100),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          return {
            success: false,
            message:
              errorData.message ||
              `Add to cart failed: ${response.status}`,
          };
        }

        const result = (await response.json()) as AddToCartResult;
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          success: false,
          message: `Erro: ${message}`,
        };
      }
    },
    []
  );

  return { results, loading, error, search, addToCart };
}
