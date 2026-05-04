import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import type { DashboardOverview, MerchantRules } from "@aacp/shared-types";
import { createDashboardApi } from "../api-client.js";
import { RulesForm } from "../components/rules-form.js";

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function OverviewDemoPage(props: {
  apiBaseUrl: string;
  defaultMerchantId: string;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);

  const [merchantId, setMerchantId] = useState(props.defaultMerchantId);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [rules, setRules] = useState<MerchantRules | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ov, rl] = await Promise.all([
        api.getDashboardOverview(merchantId),
        api.getDashboardRulesLegacy(merchantId)
      ]);
      setOverview(ov);
      setRules(rl);
    } catch {
      setOverview(null);
      setRules(null);
    }
  }, [api, merchantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRules() {
    if (!rules) return;
    setSaving(true);
    try {
      const saved = await api.putDashboardRulesLegacy(merchantId, rules);
      setRules(saved);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Painel (demo por merchant)</h1>
          <p>Métricas e regras via rotas públicas `/dashboard/*` por ID — sem sessão obrigatória.</p>
        </div>
        <label>
          Merchant ID (URL)
          <input value={merchantId} onChange={(event) => setMerchantId(event.target.value)} />
        </label>
      </header>

      <section className="metrics">
        <Metric label="Conversas" value={overview?.conversations_started ?? "—"} />
        <Metric label="Ofertas aceitas" value={overview?.offers_accepted ?? "—"} />
        <Metric label="Pedidos" value={overview?.orders_completed ?? "—"} />
        <Metric
          label="Conversao agente"
          value={overview?.conversion_rate_with_agent !== undefined ? `${Math.round((overview.conversion_rate_with_agent ?? 0) * 100)}%` : "—"}
        />
        <Metric
          label="Receita atribuida"
          value={overview?.incremental_revenue !== undefined ? `R$ ${(overview.incremental_revenue ?? 0).toFixed(2)}` : "—"}
        />
      </section>

      <section className="layout">
        <div className="panel">
          <div className="panel-title">
            <h2>Regras comerciais (legacy)</h2>
            <button onClick={() => void saveRules()} disabled={saving || !rules}>
              <Save size={16} />
              Salvar
            </button>
          </div>
          {rules ? <RulesForm rules={rules} onChange={setRules} /> : <p>Carregando regras...</p>}
        </div>

        <div className="panel">
          <div className="panel-title">
            <h2>Atividade</h2>
            <button type="button" onClick={() => void load()}>
              <RefreshCw size={16} />
              Atualizar
            </button>
          </div>
          <h3>Ofertas recentes</h3>
          <div className="list">
            {overview?.recent_offers?.length ? (
              overview.recent_offers.map((offer) => (
                <article key={offer.id}>
                  <strong>{offer.type}</strong>
                  <span>
                    {offer.approved ? "Aprovada" : "Bloqueada"} · {offer.reason}
                  </span>
                  <span>Margem: {Math.round(offer.marginAfterOffer * 100)}%</span>
                </article>
              ))
            ) : (
              <p>Nenhuma oferta registrada.</p>
            )}
          </div>
          <h3>Sessoes recentes</h3>
          <div className="list">
            {overview?.recent_sessions?.length ? (
              overview.recent_sessions.map((session) => (
                <article key={session.sessionId}>
                  <strong>{session.sessionId}</strong>
                  <span>{session.globalUserId}</span>
                  <span>Score: {Math.round(session.abandonmentScore * 100)}%</span>
                </article>
              ))
            ) : (
              <p>Nenhuma sessao registrada.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
