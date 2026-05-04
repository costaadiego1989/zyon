import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RefreshCw, Save } from "lucide-react";
import type { DashboardOverview, MerchantRules } from "@aacp/shared-types";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const DEFAULT_MERCHANT_ID = import.meta.env.VITE_MERCHANT_ID ?? "mrc_demo";

function Dashboard() {
  const [merchantId, setMerchantId] = useState(DEFAULT_MERCHANT_ID);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [rules, setRules] = useState<MerchantRules | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, [merchantId]);

  async function load() {
    const [overviewResponse, rulesResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/dashboard/overview/${merchantId}`),
      fetch(`${API_BASE_URL}/dashboard/rules/${merchantId}`)
    ]);
    setOverview((await overviewResponse.json()) as DashboardOverview);
    setRules((await rulesResponse.json()) as MerchantRules);
  }

  async function saveRules() {
    if (!rules) return;
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/dashboard/rules/${merchantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rules)
      });
      setRules((await response.json()) as MerchantRules);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>AI Checkout Sales Agent</h1>
          <p>Regras, ofertas e conversao por merchant.</p>
        </div>
        <label>
          Merchant
          <input value={merchantId} onChange={(event) => setMerchantId(event.target.value)} />
        </label>
      </header>

      <section className="metrics">
        <Metric label="Conversas" value={overview?.conversations_started ?? 0} />
        <Metric label="Ofertas aceitas" value={overview?.offers_accepted ?? 0} />
        <Metric label="Pedidos" value={overview?.orders_completed ?? 0} />
        <Metric label="Conversao agente" value={`${Math.round((overview?.conversion_rate_with_agent ?? 0) * 100)}%`} />
        <Metric label="Receita atribuida" value={`R$ ${(overview?.incremental_revenue ?? 0).toFixed(2)}`} />
      </section>

      <section className="layout">
        <div className="panel">
          <div className="panel-title">
            <h2>Regras comerciais</h2>
            <button onClick={saveRules} disabled={saving || !rules}>
              <Save size={16} />
              Salvar
            </button>
          </div>
          {rules ? <RulesForm rules={rules} onChange={setRules} /> : <p>Carregando regras...</p>}
        </div>

        <div className="panel">
          <div className="panel-title">
            <h2>Atividade</h2>
            <button onClick={() => void load()}>
              <RefreshCw size={16} />
              Atualizar
            </button>
          </div>
          <h3>Ofertas recentes</h3>
          <div className="list">
            {overview?.recent_offers.length ? (
              overview.recent_offers.map((offer) => (
                <article key={offer.id}>
                  <strong>{offer.type}</strong>
                  <span>{offer.approved ? "Aprovada" : "Bloqueada"} · {offer.reason}</span>
                  <span>Margem: {Math.round(offer.marginAfterOffer * 100)}%</span>
                </article>
              ))
            ) : (
              <p>Nenhuma oferta registrada ainda.</p>
            )}
          </div>
          <h3>Sessoes recentes</h3>
          <div className="list">
            {overview?.recent_sessions.length ? (
              overview.recent_sessions.map((session) => (
                <article key={session.sessionId}>
                  <strong>{session.sessionId}</strong>
                  <span>{session.globalUserId}</span>
                  <span>Score: {Math.round(session.abandonmentScore * 100)}%</span>
                </article>
              ))
            ) : (
              <p>Nenhuma sessao registrada ainda.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RulesForm({ rules, onChange }: { rules: MerchantRules; onChange: (rules: MerchantRules) => void }) {
  function patch(next: Partial<MerchantRules>) {
    onChange({ ...rules, ...next });
  }

  return (
    <div className="rules-grid">
      <NumberField label="Desconto maximo %" value={rules.maxDiscountPercent} onChange={(value) => patch({ maxDiscountPercent: value })} />
      <NumberField label="Margem minima %" value={rules.minimumMarginPercent} onChange={(value) => patch({ minimumMarginPercent: value })} />
      <NumberField label="Minimo frete gratis" value={rules.freeShippingMinCartValue} onChange={(value) => patch({ freeShippingMinCartValue: value })} />
      <NumberField label="Subsidio maximo frete" value={rules.maxShippingSubsidy} onChange={(value) => patch({ maxShippingSubsidy: value })} />
      <NumberField label="Frete parcial maximo" value={rules.maxPartialShippingDiscount} onChange={(value) => patch({ maxPartialShippingDiscount: value })} />
      <NumberField label="Expira em minutos" value={rules.offerExpirationMinutes} onChange={(value) => patch({ offerExpirationMinutes: value })} />
      <label className="toggle">
        <input type="checkbox" checked={rules.allowFreeShipping} onChange={(event) => patch({ allowFreeShipping: event.target.checked })} />
        Permitir frete gratis
      </label>
      <label className="toggle">
        <input type="checkbox" checked={rules.allowShippingDiscount} onChange={(event) => patch({ allowShippingDiscount: event.target.checked })} />
        Permitir frete parcial
      </label>
      <label>
        Voz da marca
        <select value={rules.brandVoice} onChange={(event) => patch({ brandVoice: event.target.value as MerchantRules["brandVoice"] })}>
          <option value="consultative">Consultiva</option>
          <option value="aggressive">Agressiva</option>
          <option value="premium">Premium</option>
          <option value="young">Jovem</option>
          <option value="technical">Tecnica</option>
          <option value="popular">Popular</option>
        </select>
      </label>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

createRoot(document.getElementById("root")!).render(<Dashboard />);
