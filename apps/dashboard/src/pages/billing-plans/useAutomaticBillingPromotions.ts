import { useEffect, useState } from "react";
import { automaticBillingPromotion, type AutomaticBillingPromotion, type BillingCycle } from "@zyon/shared-types";
import { useApi } from "../../hooks/useApi.js";

export function useAutomaticBillingPromotions() {
  const api = useApi();
  const [campaigns, setCampaigns] = useState<AutomaticBillingPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const items = await api.listAutomaticBillingPromotions();
        if (current) { setCampaigns(items); setError(false); setNow(Date.now()); }
      } catch { if (current) setError(true); }
      finally { if (current) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { if (current) setNow(Date.now()); }, 1000);
    const refresh = setInterval(() => void load(), 60000);
    return () => { current = false; clearInterval(timer); clearInterval(refresh); };
  }, [api]);
  return { loading, error, forPlan: (plan: string, cycle: BillingCycle) => automaticBillingPromotion(campaigns, plan, cycle, now) };
}
