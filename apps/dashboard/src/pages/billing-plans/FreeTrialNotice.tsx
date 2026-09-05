import React, { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import type { BillingSubscription } from "../../api/types.js";

export function FreeTrialNotice({ onViewPlans }: { onViewPlans: () => void }) {
  const api = useApi();
  const [sub, setSub] = useState<BillingSubscription | null>(null);
  useEffect(() => {
    let stopped = false;
    const refresh = () => { void api.getBillingSubscription().then(value => { if (!stopped) setSub(value); }).catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [api]);
  if (!sub || sub.plan !== "starter" || (!sub.trial_expired && sub.status !== "trialing")) return null;
  return <aside className="free-trial-notice" role="status">
    <span>{sub.trial_expired
      ? "Seu período grátis de 14 dias expirou. Seu acesso continua liberado, com taxa de R$ 2,99 por transação."
      : `Você tem ${sub.trial_days_remaining ?? 0} dia(s) restantes sem taxa de transação Zyon no Free.`}</span>
    <button type="button" onClick={onViewPlans}>Ver planos</button>
  </aside>;
}
