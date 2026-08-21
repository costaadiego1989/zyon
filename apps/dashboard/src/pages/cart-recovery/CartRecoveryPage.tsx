import React, { useState } from "react";
import { ShoppingCart, Send, CheckCircle, XCircle, Clock, Wallet, Target, RefreshCw } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { StatCard } from "../../components/stat-card.js";
import { useCartRecoveryPage } from "./useCartRecoveryPage.js";

export interface CartRecoveryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const CARD: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: "24px 28px",
};

interface StrategyConfig {
  tier: string;
  label: string;
  description: string;
  enabled: boolean;
}

export function CartRecoveryPage(props: CartRecoveryPageProps) {
  const { metrics, attempts, loading } = useCartRecoveryPage();
  const [strategies, setStrategies] = useState<StrategyConfig[]>([
    { tier: "free_shipping", label: "Frete Grátis", description: "Oferecer frete grátis como incentivo", enabled: true },
    { tier: "escalate_discount", label: "Desconto Escalonado", description: "Aumentar desconto progressivamente", enabled: true },
    { tier: "cross_sell", label: "Cross-sell", description: "Sugerir produtos complementares", enabled: true },
    { tier: "address_objection", label: "Endereçar Objeção", description: "Responder à objeção principal do comprador", enabled: true },
    { tier: "wait", label: "Esperar", description: "Aguardar antes de novo contato", enabled: false },
  ]);

  if (!props.me) {
    return <p style={{ color: "var(--faint)", font: "13px var(--sans)" }}>Login necessário</p>;
  }

  if (loading) {
    return (
      <div className="panel" style={{ padding: "60px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>
        Carregando...
      </div>
    );
  }

  const toggleStrategy = (tier: string) => {
    setStrategies(prev => prev.map(s => s.tier === tier ? { ...s, enabled: !s.enabled } : s));
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "recovered": return <CheckCircle size={14} color="var(--good)" />;
      case "failed": return <XCircle size={14} color="var(--danger)" />;
      case "sent": return <RefreshCw size={14} color="var(--accent)" />;
      default: return <Clock size={14} color="var(--faint)" />;
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
      case "escalate_discount": return "Desconto";
      case "cross_sell": return "Cross-sell";
      case "address_objection": return "Objeção";
      case "wait": return "Espera";
      default: return strategy;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <SectionHeader
        icon={<ShoppingCart size={18} aria-hidden="true" />}
        title="Cart Recovery"
        subtitle="Métricas de recuperação de carrinhos e configuração de estratégias"
      />

      {/* Metric cards */}
      {metrics && (
        <div className="metrics">
          <StatCard
            icon={ShoppingCart}
            value={metrics.total_abandoned.toLocaleString("pt-BR")}
            label="Abandonados"
          />
          <StatCard
            icon={Send}
            value={metrics.total_attempts.toLocaleString("pt-BR")}
            label="Tentativas"
          />
          <StatCard
            icon={CheckCircle}
            value={metrics.total_recovered.toLocaleString("pt-BR")}
            label="Recuperados"
          />
          <StatCard
            icon={Target}
            value={`${metrics.recovery_rate_percent.toFixed(1)}%`}
            label="Taxa Recuperação"
          />
          <StatCard
            icon={Wallet}
            value={`R$ ${metrics.revenue_recovered_brl.toLocaleString("pt-BR")}`}
            label="Receita Recuperada"
          />
        </div>
      )}

      {/* Strategy config */}
      <div style={CARD}>
        <div style={{ font: "600 12px var(--sans)", color: "var(--ink)", marginBottom: 16 }}>Configuração de Estratégias</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {strategies.map((s) => (
            <div key={s.tier} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <ToggleSwitch checked={s.enabled} onChange={() => toggleStrategy(s.tier)} />
              <div style={{ flex: 1 }}>
                <div style={{ font: "13px var(--sans)", color: "var(--ink)", fontWeight: 500 }}>{s.label}</div>
                <div style={{ font: "12px var(--sans)", color: "var(--muted)" }}>{s.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Attempts table */}
      <div style={CARD}>
        <div style={{ font: "600 12px var(--sans)", color: "var(--ink)", marginBottom: 14 }}>Tentativas Recentes</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "12px var(--sans)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Sessão</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Estratégia</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Status</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "var(--faint)", fontWeight: 600, font: "11px var(--mono)" }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px", color: "var(--muted)", font: "12px var(--mono)" }}>{a.session_id.slice(0, 12)}...</td>
                  <td style={{ padding: "8px 12px", color: "var(--ink)" }}>{strategyLabel(a.strategy)}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {statusIcon(a.status)}
                      <span style={{ color: "var(--muted)" }}>{statusLabel(a.status)}</span>
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--faint)", font: "12px var(--mono)" }}>
                    {new Date(a.created_at).toLocaleString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
