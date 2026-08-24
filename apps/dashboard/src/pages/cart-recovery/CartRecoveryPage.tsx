import React, { useState } from "react";
import { ShoppingCart, Activity, CheckCircle, DollarSign, Clock, XCircle, RefreshCw } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { StatCard } from "../overview/components/StatCard.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Pagination } from "../../components/Pagination.js";
import { EmptyState } from "../../components/EmptyState.js";
import { useCartRecoveryPage } from "./useCartRecoveryPage.js";
import type { CartRecoveryStrategyKey } from "../../api/endpoints/cart-recovery.js";

export interface CartRecoveryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const PANEL: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "24px 28px",
};

interface StrategyDisplayConfig {
  key: CartRecoveryStrategyKey;
  label: string;
  description: string;
}

const STRATEGY_DISPLAY: StrategyDisplayConfig[] = [
  { key: "offer_free_shipping", label: "Frete Grátis", description: "Oferecer frete grátis como incentivo" },
  { key: "personalized_cross_sell", label: "Cross-sell", description: "Sugerir produtos complementares" },
  { key: "offer_coupon", label: "Cupom", description: "Oferecer cupom de desconto para fechar" },
];

const PAGE_SIZE = 10;

export function CartRecoveryPage(props: CartRecoveryPageProps) {
  const {
    metrics,
    attempts,
    strategies,
    savingKey,
    loading,
    toggleStrategy,
  } = useCartRecoveryPage();

  const [page, setPage] = useState(1);

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Cart Recovery</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  if (loading) {
    return (
      <div className="panel" style={{ padding: "60px 22px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
        Carregando...
      </div>
    );
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "recovered": return <CheckCircle size={14} color="var(--color-success)" />;
      case "failed": return <XCircle size={14} color="var(--color-error)" />;
      case "sent": return <RefreshCw size={14} color="var(--color-brand)" />;
      default: return <Clock size={14} color="var(--color-text-faint)" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "recovered": return "Recuperado";
      case "failed": return "Falhou";
      case "sent": return "Enviado";
      default: return "Pendente";
    }
  };

  const strategyLabel = (strategy: string) => {
    switch (strategy) {
      case "free_shipping": return "Frete Grátis";
      case "coupon": return "Cupom";
      case "cross_sell": return "Cross-sell";
      default: return strategy;
    }
  };

  // Pagination logic
  const totalAttempts = attempts.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const paginatedAttempts = attempts.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Cart Recovery</h1>
          <p className="page-lead">Métricas de recuperação de carrinhos e configuração de estratégias</p>
        </div>
      </header>

      {/* KPI cards — official StatCard from overview */}
      {metrics && (
        <div className="grid-4" style={{ gap: 14 }}>
          <StatCard
            icon={<ShoppingCart size={16} />}
            label="Carrinhos abandonados"
            value={metrics.total_abandoned.toLocaleString("pt-BR")}
          />
          <StatCard
            icon={<Activity size={16} />}
            label="Tentativas de recuperação"
            value={metrics.total_attempts.toLocaleString("pt-BR")}
          />
          <StatCard
            icon={<CheckCircle size={16} />}
            label="Recuperados"
            value={metrics.total_recovered.toLocaleString("pt-BR")}
            accent="var(--color-success)"
          />
          <StatCard
            icon={<DollarSign size={16} />}
            label="Receita recuperada"
            value={`R$ ${metrics.revenue_recovered_brl.toLocaleString("pt-BR")}`}
            accent="var(--color-brand)"
          />
        </div>
      )}

      {/* Strategy config */}
      <div style={PANEL}>
        <SectionHeader variant="secondary" title="Configuração de Estratégias" />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {STRATEGY_DISPLAY.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--color-border)" }}>
              <ToggleSwitch
                checked={strategies[s.key]}
                onChange={() => toggleStrategy(s.key)}
                disabled={savingKey === s.key}
              />
              <div style={{ flex: 1 }}>
                <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)", fontWeight: 500 }}>{s.label}</div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>{s.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Attempts table */}
      <div style={PANEL}>
        <SectionHeader variant="secondary" title="Tentativas Recentes" />
        {attempts.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="Nenhuma tentativa registrada"
            description="As tentativas aparecerão aqui conforme os agentes tentam recuperar carrinhos abandonados."
          />
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", font: "12px var(--font-sans)" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600, font: "11px var(--font-mono)" }}>Sessão</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600, font: "11px var(--font-mono)" }}>Estratégia</th>
                    <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600, font: "11px var(--font-mono)" }}>Status</th>
                    <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--color-text-faint)", fontWeight: 600, font: "11px var(--font-mono)" }}>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedAttempts.map((a) => (
                    <tr key={a.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "8px 12px", color: "var(--color-text-muted)", font: "12px var(--font-mono)" }}>{a.session_id.slice(0, 12)}...</td>
                      <td style={{ padding: "8px 12px", color: "var(--color-text)" }}>{strategyLabel(a.strategy)}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {statusIcon(a.status)}
                          <span style={{ color: "var(--color-text-muted)" }}>{statusLabel(a.status)}</span>
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--color-text-faint)", font: "12px var(--font-mono)" }}>
                        {new Date(a.created_at).toLocaleString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalAttempts > PAGE_SIZE && (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={totalAttempts}
                onChange={setPage}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
