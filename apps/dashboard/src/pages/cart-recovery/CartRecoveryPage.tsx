import React, { useState } from "react";
import { ShoppingCart, Activity, CheckCircle, DollarSign, Clock, XCircle, RefreshCw } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { useCartRecoveryPage } from "./useCartRecoveryPage.js";
import type { CartRecoveryStrategyKey } from "../../api/endpoints/cart-recovery.js";

export interface CartRecoveryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

interface StrategyOption {
  key: CartRecoveryStrategyKey;
  label: string;
  description: string;
}

const STRATEGY_OPTIONS: StrategyOption[] = [
  { key: "offer_free_shipping", label: "Frete Grátis", description: "Oferecer frete grátis como incentivo para fechar a compra" },
  { key: "personalized_cross_sell", label: "Cross-sell", description: "Sugerir produtos complementares baseados no histórico do comprador" },
  { key: "offer_coupon", label: "Cupom de Desconto", description: "Enviar cupom de desconto via WhatsApp para incentivar a conversão" },
  { key: "advanced_rule", label: "Regra Avançada", description: "Usar regras do engine de negociação (desconto progressivo, objeção, timing)" },
];

const PAGE_SIZE = 10;

export function CartRecoveryPage(props: CartRecoveryPageProps) {
  const {
    metrics,
    attempts,
    strategies,
    savingKey,
    loading,
    selectStrategy,
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
      case "free_shipping":
      case "offer_free_shipping": return "Frete Grátis";
      case "coupon":
      case "offer_coupon":
      case "escalate_discount": return "Cupom";
      case "cross_sell":
      case "personalized_cross_sell": return "Cross-sell";
      case "address_objection":
      case "advanced_rule": return "Regra Avançada";
      case "wait_and_retry": return "Aguardar e tentar";
      default: return strategy;
    }
  };

  const totalAttempts = attempts.length;
  const startIdx = (page - 1) * PAGE_SIZE;
  const paginatedAttempts = attempts.slice(startIdx, startIdx + PAGE_SIZE);
  const activeKey = (Object.entries(strategies).find(([, v]) => v)?.[0] ?? "offer_coupon") as CartRecoveryStrategyKey;

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Cart Recovery</h1>
          <p className="page-lead">Recuperação automática de carrinhos abandonados via WhatsApp</p>
        </div>
      </header>

      {/* Explicação */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        font: "13px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.65,
      }}>
        <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong>{" "}
        Quando um comprador abandona o carrinho, o sistema detecta automaticamente e envia uma mensagem de recuperação
        via WhatsApp com a estratégia configurada abaixo. Apenas uma estratégia pode estar ativa por vez.
      </div>

      {/* KPI cards */}
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

      {/* Strategy selection — radio (only 1 active) */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader title="Estratégia de recuperação" subtitle="Escolha o que enviar via WhatsApp quando um carrinho for abandonado. Apenas uma opção pode estar ativa." />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {STRATEGY_OPTIONS.map((opt) => {
            const isActive = activeKey === opt.key;
            const isSaving = savingKey === opt.key;
            return (
              <label
                key={opt.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  borderRadius: "var(--radius-sm)",
                  border: `1.5px solid ${isActive ? "var(--color-brand)" : "var(--color-border)"}`,
                  background: isActive ? "var(--accent-soft)" : "transparent",
                  cursor: isSaving ? "wait" : "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                  opacity: isSaving ? 0.6 : 1,
                }}
                onClick={(e) => {
                  e.preventDefault();
                  if (!isSaving && !isActive) selectStrategy(opt.key);
                }}
              >
                <span style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: `2px solid ${isActive ? "var(--color-brand)" : "var(--color-border)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {isActive && (
                    <span style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: "var(--color-brand)",
                    }} />
                  )}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "500 13px var(--font-sans)", color: isActive ? "var(--color-brand)" : "var(--color-text)" }}>
                    {opt.label}
                  </div>
                  <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>
                    {opt.description}
                  </div>
                </div>
                {isActive && (
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                    font: "600 10px var(--font-mono)",
                    background: "var(--color-success-bg)",
                    color: "var(--color-success)",
                  }}>
                    Ativa
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Attempts table */}
      <DataPanel
        title="Tentativas Recentes"
        page={page}
        pageSize={PAGE_SIZE}
        total={totalAttempts}
        onPageChange={setPage}
        isEmpty={attempts.length === 0}
        empty={{ icon: ShoppingCart, title: "Nenhuma tentativa registrada", description: "As tentativas aparecerão aqui conforme o sistema tenta recuperar carrinhos abandonados via WhatsApp." }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Sessão</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Estratégia</th>
                <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Status</th>
                <th style={{ textAlign: "right", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAttempts.map((a, i) => (
                <tr key={a.id} style={{ borderBottom: i < paginatedAttempts.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                  <td style={{ padding: "12px 20px", color: "var(--color-text-muted)", font: "12px var(--font-mono)" }}>{a.session_id.slice(0, 12)}...</td>
                  <td style={{ padding: "12px 20px", font: "13px var(--font-sans)", color: "var(--color-text)" }}>{strategyLabel(a.strategy)}</td>
                  <td style={{ padding: "12px 20px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {statusIcon(a.status)}
                      <span style={{ color: "var(--color-text-muted)", font: "12px var(--font-sans)" }}>{statusLabel(a.status)}</span>
                    </span>
                  </td>
                  <td style={{ padding: "12px 20px", textAlign: "right", color: "var(--color-text-faint)", font: "12px var(--font-mono)" }}>
                    {new Date(a.created_at).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataPanel>
    </div>
  );
}
