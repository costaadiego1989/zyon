import { useEffect, useState } from "react";
import type { SupportFaqItem } from "@zyon/shared-types";

interface UseSupportFaqResult {
  items: SupportFaqItem[];
  loading: boolean;
}

export function useSupportFaq(
  apiBaseUrl: string,
  merchantId: string,
  enabled = true,
  embedToken?: string,
): UseSupportFaqResult {
  const [items, setItems] = useState<SupportFaqItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !merchantId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // /support/faq derives the merchant from the verified embed token
    // (ADR-0003); the merchant_id query param is ignored by the API.
    const headers: Record<string, string> = {};
    if (embedToken?.trim()) headers["x-aacp-embed-token"] = embedToken.trim();
    fetch(`${apiBaseUrl}/support/faq`, { headers })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { faqItems?: SupportFaqItem[] }) => {
        if (!cancelled) setItems(data.faqItems ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [apiBaseUrl, merchantId, enabled, embedToken]);

  return { items, loading };
}
