import React, { useEffect, useState } from "react";
import { Clock, ArrowRight } from "lucide-react";
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
  const expired = sub.trial_expired;
  const remaining = sub.trial_days_remaining ?? 0;
  return (
    <aside className="free-trial-notice" role="status">
      <span className="free-trial-notice__icon" aria-hidden="true">
        <Clock size={20} />
      </span>
      <div className="free-trial-notice__body">
        <strong className="free-trial-notice__title">
          {expired ? "Período grátis encerrado" : `${remaining} dia${remaining === 1 ? "" : "s"} restante${remaining === 1 ? "" : "s"}`}
        </strong>
        <p className="free-trial-notice__text">
          {expired
            ? "Seu acesso continua liberado, com taxa de R$ 2,99 por transação."
            : "Sem taxa de transação Zyon durante o Free."}
        </p>
      </div>
      <button type="button" className="free-trial-notice__cta" onClick={onViewPlans}>
        Ver planos <ArrowRight size={14} />
      </button>
    </aside>
  );
}
