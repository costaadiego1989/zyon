import React, { useState } from "react";
import { ShoppingCart, Activity, CheckCircle, DollarSign, Clock, XCircle, RefreshCw, Edit, Ticket, SlidersHorizontal, AlertTriangle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Button } from "../../components/Button.js";
import { PageLoader } from "../../components/PageLoader.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { SidePanel } from "../../components/SidePanel.js";
import { TabBar } from "../../components/TabBar.js";
import { useCartRecoveryPage } from "./useCartRecoveryPage.js";
import type { CartRecoveryStrategyKey } from "../../api/endpoints/cart-recovery.js";
import { RecoveryTemplatesPanel } from "./RecoveryTemplatesPanel.js";
import "./cart-recovery.css";

export interface CartRecoveryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

interface StrategyOption {
  key: CartRecoveryStrategyKey;
  label: string;
  description: string;
  needsConfig: boolean;
  configLabel?: string;
}

const STRATEGY_OPTIONS: StrategyOption[] = [
  { key: "offer_free_shipping", label: "Frete Grátis", description: "Oferecer frete grátis como incentivo para fechar a compra", needsConfig: false },
  { key: "personalized_cross_sell", label: "Cross-sell", description: "Sugerir produtos complementares baseados no histórico do comprador", needsConfig: false },
  { key: "offer_coupon", label: "Cupom de Desconto", description: "Usar um cupom configurado e válido na recuperação", needsConfig: true, configLabel: "Selecionar cupom" },
  { key: "advanced_rule", label: "Regra Avançada", description: "Usar regras do engine de negociação (desconto progressivo, objeção, timing)", needsConfig: true, configLabel: "Selecionar regra" },
];

const PAGE_SIZE = 10;

export function CartRecoveryPage(props: CartRecoveryPageProps) {
  const {
    metrics,
    attempts,
    config,
    savingKey,
    loading,
    error,
    retry,
    selectStrategy,
    saveConfig,
    coupons,
    rules,
  } = useCartRecoveryPage();

  const [page, setPage] = useState(1);
  const [tab, setTab] = useState("overview");
  const [panelOpen, setPanelOpen] = useState<"coupon" | "rule" | null>(null);

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Recuperação de Carrinho</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  if (loading) {
    return <PageLoader />;
  }

  if (error) {
    return <EmptyState icon={AlertTriangle} title="Recuperação indisponível" description={error}
      action={<Button onClick={retry}>Tentar novamente</Button>} />;
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
      case "unknown": return "Aguardando confirmação";
      case "expired": return "Expirado";
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
  const activeKey = config.active_strategy;

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Recuperação de Carrinho</h1>
          <p className="page-lead">Recuperação automática de carrinhos abandonados por WhatsApp ou e-mail</p>
        </div>
      </header>

      <div className="recovery-page-tabs">
        <TabBar
          label="Recuperação de carrinho"
          tabs={[{ key: "overview", label: "Visão geral", panelId: "recovery-overview" }, { key: "messages", label: "Mensagens", panelId: "recovery-messages" }]}
          activeTab={tab}
          onTabChange={setTab}
        />
      </div>

      <div hidden={tab !== "messages"} role="tabpanel" id="recovery-messages" aria-labelledby="recovery-messages-tab">
        <RecoveryTemplatesPanel key={props.me.id} apiBaseUrl={props.apiBaseUrl} />
      </div>

      <div hidden={tab !== "overview"} role="tabpanel" id="recovery-overview" aria-labelledby="recovery-overview-tab" className="recovery-overview">

      {/* KPI cards */}
      {metrics && (
        <div className="grid-4" style={{ gap: 14 }}>
          <StatCard
            icon={<ShoppingCart size={16} />}
            label="Carrinhos abandonados"
            value={metrics.total_abandoned?.toLocaleString("pt-BR") ?? "Indisponível"}
          />
          <StatCard
            icon={<Activity size={16} />}
            label="Tentativas de recuperação"
            value={metrics.total_attempts?.toLocaleString("pt-BR") ?? "Indisponível"}
          />
          <StatCard
            icon={<CheckCircle size={16} />}
            label="Recuperados"
            value={metrics.total_recovered?.toLocaleString("pt-BR") ?? "Indisponível"}
            accent="var(--color-success)"
          />
          <StatCard
            icon={<DollarSign size={16} />}
            label="Receita recuperada"
            value={metrics.revenue_recovered_brl === null ? "Indisponível" : `R$ ${metrics.revenue_recovered_brl.toLocaleString("pt-BR")}`}
            accent="var(--color-brand)"
          />
        </div>
      )}

      {/* Strategy selection — radio (only 1 active) */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader title="Estratégia de recuperação" subtitle="Escolha a estratégia para recuperar carrinhos. Apenas uma opção pode estar ativa." />
        <fieldset className="recovery-strategies" disabled={savingKey !== null} aria-label="Estratégia de recuperação" aria-busy={savingKey !== null}>
          {STRATEGY_OPTIONS.map(opt => {
            const active = activeKey === opt.key;
            const linked = opt.key === "offer_coupon" ? config.coupon_code
              : opt.key === "advanced_rule" ? rules.find(rule => rule.id === config.rule_id)?.name : undefined;
            return (
              <div key={opt.key} className="recovery-strategy" data-active={active}>
                <label className="recovery-strategy__choice">
                  <input type="radio" name="recovery-strategy" value={opt.key} checked={active}
                    onChange={() => { void selectStrategy(opt.key); }} />
                  <span className="recovery-strategy__copy">
                    <span className="recovery-strategy__title">{opt.label}</span>
                    <span className="recovery-strategy__description">{opt.description}</span>
                    {active && opt.needsConfig ? <span className="recovery-strategy__link">{linked || "Vínculo necessário"}</span> : null}
                  </span>
                </label>
                {active && opt.needsConfig ? (
                  <Button variant="outline" size="sm" disabled={savingKey !== null}
                    onClick={() => setPanelOpen(opt.key === "offer_coupon" ? "coupon" : "rule")}>
                    <Edit size={14} /> {linked ? "Alterar vínculo" : "Vincular"}
                  </Button>
                ) : active ? <span className="recovery-strategy__link">Selecionada</span> : null}
              </div>
            );
          })}
        </fieldset>
        {/* Coupon-strategy conflict warning: coupon discount must not stack with
            advanced rules or progressive discount configured in checkout settings. */}
        {activeKey === "offer_coupon" && (
          <div
            role="note"
            style={{
              marginTop: 12,
              padding: "12px 14px",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-warning-bg)",
              border: "1px solid var(--color-border)",
              font: "12px var(--font-sans)",
              color: "var(--color-text)",
              lineHeight: 1.5,
            }}
          >
            O cupom depende da validade e das condições do carrinho. Ele não acumula com
            descontos já concedidos por regras avançadas ou desconto progressivo.
          </div>
        )}
      </div>

      {/* Attempts table */}
      <DataPanel
        title="Tentativas Recentes"
        page={page}
        pageSize={PAGE_SIZE}
        total={totalAttempts}
        onPageChange={setPage}
        isEmpty={attempts.length === 0}
        empty={{ icon: ShoppingCart, title: "Nenhuma tentativa registrada", description: "As tentativas aparecerão aqui conforme o sistema tenta recuperar carrinhos abandonados." }}
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

      {/* Side Panel — Coupon Selection */}
      <SidePanel
        isOpen={panelOpen === "coupon"}
        title="Vincular Cupom"
        onClose={() => setPanelOpen(null)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            Selecione o cupom para a estratégia de recuperação. A aplicação depende das regras da loja.
          </div>

          {coupons.length === 0 ? (
            <EmptyState icon={Ticket} title="Nenhum cupom disponível" description="Crie um cupom ativo e dentro da validade na página Cupons." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {coupons.map((c) => {
                const isSelected = config.coupon_code === c.code;
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={savingKey !== null}
                    onClick={async () => {
                      if (await saveConfig({ active_strategy: "offer_coupon", coupon_code: c.code })) setPanelOpen(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: `1.5px solid ${isSelected ? "var(--color-brand)" : "var(--color-border)"}`,
                      background: isSelected ? "var(--accent-soft)" : "var(--surface-1)",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      font: "inherit",
                      transition: "border-color 0.15s",
                    }}
                  >
                    <span style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: `2px solid ${isSelected ? "var(--color-brand)" : "var(--color-border)"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isSelected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-brand)" }} />}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>
                        {c.code}
                      </div>
                      <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>
                        {c.discountType === "free_shipping" ? "Frete grátis" : c.discountType === "percent" ? `${c.discountValue}% de desconto` : `R$ ${c.discountValue.toLocaleString("pt-BR")} de desconto`}
                      </div>
                    </div>
                    {isSelected && (
                      <span style={{ padding: "2px 6px", borderRadius: "var(--radius-full)", font: "600 9px var(--font-mono)", background: "var(--color-success-bg)", color: "var(--color-success)" }}>
                        Vinculado
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SidePanel>

      {/* Side Panel — Rule Selection */}
      <SidePanel
        isOpen={panelOpen === "rule"}
        title="Vincular Regra Avançada"
        onClose={() => setPanelOpen(null)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            Selecione a regra que será usada na recuperação. A regra define desconto progressivo, tratamento de objeções ou timing.
          </div>

          {rules.length === 0 ? (
            <EmptyState icon={SlidersHorizontal} title="Nenhuma regra ativa" description="Crie e ative uma regra em Configurações do Checkout, na aba Regras." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rules.map((r) => {
                const isSelected = config.rule_id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={savingKey !== null}
                    onClick={async () => {
                      if (await saveConfig({ active_strategy: "advanced_rule", rule_id: r.id })) setPanelOpen(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: "var(--radius-sm)",
                      border: `1.5px solid ${isSelected ? "var(--color-brand)" : "var(--color-border)"}`,
                      background: isSelected ? "var(--accent-soft)" : "var(--surface-1)",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                      font: "inherit",
                      transition: "border-color 0.15s",
                    }}
                  >
                    <span style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: `2px solid ${isSelected ? "var(--color-brand)" : "var(--color-border)"}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isSelected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-brand)" }} />}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>
                        {r.name}
                      </div>
                      <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", marginTop: 2 }}>
                        {r.id}
                      </div>
                    </div>
                    {isSelected && (
                      <span style={{ padding: "2px 6px", borderRadius: "var(--radius-full)", font: "600 9px var(--font-mono)", background: "var(--color-success-bg)", color: "var(--color-success)" }}>
                        Vinculada
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SidePanel>
    </div>
  );
}
