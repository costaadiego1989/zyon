import React, { useCallback, useEffect, useRef, useState } from "react";
import { Lightbulb, ArrowUpRight } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { usePlanFeatures } from "../../../hooks/api/usePlanFeatures.js";
import type { MerchantProfile } from "../../../api-client.js";
import type { Hypothesis } from "../../../api/endpoints/revenue-manager.js";
import { openStrategyReview, STRATEGY_CHANGED_EVENT } from "../../revenue-manager/strategy-review.js";
import "../../revenue-manager/strategy-review.css";

export function AISuggestionsPanel({ me }: { me: MerchantProfile }) {
  const { hasFeature, loading, error } = usePlanFeatures();
  if (loading || error || !hasFeature("revenueManager")) return null;
  return <PendingStrategies key={me.id} />;
}

function PendingStrategies() {
  const api = useApi();
  const [items, setItems] = useState<Hypothesis[]>([]);
  const [error, setError] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { setItems(await api.getHypotheses({ status: "pending_review", limit: 100 })); setError(false); }
    catch { setError(true); }
    finally { inFlight.current = false; }
  }, [api]);
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 30_000);
    const reload = () => { void load(); };
    window.addEventListener(STRATEGY_CHANGED_EVENT, reload);
    window.addEventListener("focus", reload);
    return () => { window.clearInterval(interval); window.removeEventListener(STRATEGY_CHANGED_EVENT, reload); window.removeEventListener("focus", reload); };
  }, [load]);
  if (!items.length && !error) return null;
  return <section className="strategy-notice" aria-labelledby="strategy-notice-title">
    <div className="strategy-notice-head"><Lightbulb size={22} aria-hidden="true" /><div>
      <h2 id="strategy-notice-title">{items.length ? `${items.length} ${items.length === 1 ? "estratégia aguarda" : "estratégias aguardam"} sua aprovação` : "Sugestões de estratégia"}</h2>
    </div></div>
    {error && <p role="status">Não foi possível atualizar as sugestões. <button type="button" className="zyn-btn zyn-btn--ghost" onClick={() => void load()}>Tentar novamente</button></p>}
    <div className="strategy-notice-list">{(showAll ? items : items.slice(0, 3)).map(h => <div key={h.id} className="strategy-notice-row">
      <div><strong>{h.hypothesis_text}</strong></div>
      <div className="strategy-review-actions"><button type="button" className="zyn-btn zyn-btn--primary" onClick={() => openStrategyReview(h.id)}>
        Revisar e aprovar <ArrowUpRight size={15} aria-hidden="true" />
      </button></div>
    </div>)}</div>
    {items.length > 3 && <button type="button" className="zyn-btn zyn-btn--ghost strategy-notice-more" onClick={() => setShowAll(value => !value)}>{showAll ? "Mostrar menos" : `Ver mais ${items.length - 3} sugestões`}</button>}
  </section>;
}
