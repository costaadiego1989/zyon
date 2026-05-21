import { useEffect, useState } from "react";
import type { SupportFaqItem } from "@aacp/shared-types";

interface UseSupportFaqResult {
  items: SupportFaqItem[];
  loading: boolean;
}

export function useSupportFaq(apiBaseUrl: string, merchantId: string, enabled = true): UseSupportFaqResult {
  const [items, setItems] = useState<SupportFaqItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !merchantId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${apiBaseUrl}/support/faq?merchant_id=${encodeURIComponent(merchantId)}`)
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
  }, [apiBaseUrl, merchantId, enabled]);

  return { items, loading };
}
