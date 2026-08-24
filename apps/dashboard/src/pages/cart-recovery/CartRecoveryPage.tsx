import React, { useState } from "react";
import { ShoppingCart, Activity, CheckCircle, DollarSign, Clock, XCircle, RefreshCw, Edit } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { SidePanel } from "../../components/SidePanel.js";
import { Button } from "../../components/Button.js";
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
  needsConfig: boolean;
  configLabel?: string;
}

const STRATEGY_OPTIONS: StrategyOption[] = [
  { key: "offer_free_shipping", label: "Frete Grátis", description: "Oferecer frete grátis como incentivo para fechar a compra", needsConfig: false },
  { key: "personalized_cross_sell", label: "Cross-sell", description: "Sugerir produtos complementares baseados no histórico do comprador", needsConfig: false },
  { key: "offer_coupon", label: "Cupom de Desconto", description: "Enviar cupom de desconto via WhatsApp para incentivar a conversão", needsConfig: true, configLabel: "Selecionar cupom" },
  { key: "advanced_rule", label: "Regra Avançada", description: "Usar regras do engine de negociação (desconto progressivo, objeção, timing)", needsConfig: true, configLabel: "Selecionar regra" },
];

const WHATSAPP_TEMPLATES: Record<CartRecoveryStrategyKey, (config: { coupon_code?: string; rule_id?: string }) => string> = {
  offer_free_shipping: () => "🚚 *Frete grátis pra você!*\n\nSeu carrinho está esperando. Volte agora e ganhe frete grátis em todos os itens! Oferta por tempo limitado.",
  personalized_cross_sell: () => "🛒 *Esqueceu algo no carrinho?*\n\nVocê deixou itens incríveis esperando. Volte e descubra produtos que combinam com o que você escolheu!",
  offer_coupon: (cfg) => `🎫 *Cupom exclusivo pra você!*\n\nUse o código *${cfg.coupon_code || "—"}* e ganhe desconto especial na sua compra. Corre que é por tempo limitado!`,
  advanced_rule: (cfg) => `💡 *Oferta personalizada!*\n\nPreparamos uma condição especial pra você finalizar sua compra. Volte ao carrinho e confira!${cfg.rule_id ? `\n\n_Regra: ${cfg.rule_id}_` : ""}`,
};

const PAGE_SIZE = 10;

export function CartRecoveryPage(props: CartRecoveryPageProps) {
  const {
    metrics,
    attempts,
    strategies,
    config,
    savingKey,
    loading,
    selectStrategy,
    saveConfig,
    coupons,
    rules,
  } = useCartRecoveryPage();

  const [page, setPage] = useState(1);
  const [panelOpen, setPanelOpen] = useState<"coupon" | "rule" | null>(null);

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
            value={(metrics.total_abandoned ?? 0).toLocaleString("pt-BR")}
          />
          <StatCard
            icon={<Activity size={16} />}
            label="Tentativas de recuperação"
            value={(metrics.total_attempts ?? 0).toLocaleString("pt-BR")}
          />
          <StatCard
            icon={<CheckCircle size={16} />}
            label="Recuperados"
            value={(metrics.total_recovered ?? 0).toLocaleString("pt-BR")}
            accent="var(--color-success)"
          />
          <StatCard
            icon={<DollarSign size={16} />}
            label="Receita recuperada"
            value={`R$ ${(metrics.revenue_recovered_brl ?? 0).toLocaleString("pt-BR")}`}
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
                {/* Radio dot */}
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

                {/* Label + description */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ font: "500 13px var(--font-sans)", color: isActive ? "var(--color-brand)" : "var(--color-text)" }}>
                      {opt.label}
                    </span>
                    {isActive && opt.key === "offer_coupon" && config.coupon_code && (
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: "var(--color-success-bg)", color: "var(--color-success)" }}>
                        {config.coupon_code}
                      </span>
                    )}
                    {isActive && opt.key === "advanced_rule" && config.rule_id && (
                      <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: "var(--color-brand-subtle)", color: "var(--color-brand)" }}>
                        {rules.find(r => r.id === config.rule_id)?.name ?? config.rule_id}
                      </span>
                    )}
                  </div>
                  <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>
                    {opt.description}
                  </div>
                </div>

                {/* Edit button for coupon/rule when active */}
                {isActive && opt.needsConfig && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPanelOpen(opt.key === "offer_coupon" ? "coupon" : "rule");
                    }}
                    style={{
                      border: "1px solid var(--color-border)",
                      background: "var(--surface-1)",
                      cursor: "pointer",
                      padding: "6px 10px",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--color-brand)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      font: "12px var(--font-sans)",
                      flexShrink: 0,
                    }}
                    title={opt.configLabel}
                  >
                    <Edit size={14} />
                    Vincular
                  </button>
                )}

                {isActive && !opt.needsConfig && (
                  <span style={{
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                    font: "600 10px var(--font-mono)",
                    background: "var(--color-success-bg)",
                    color: "var(--color-success)",
                    flexShrink: 0,
                  }}>
                    Ativa
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* WhatsApp template preview */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader title="Preview da mensagem WhatsApp" subtitle="Mensagem que será enviada ao comprador quando o carrinho for abandonado." variant="secondary" />
        <div style={{
          padding: "16px 18px",
          borderRadius: "var(--radius-sm)",
          background: "var(--surface-0)",
          border: "1px solid var(--color-border)",
          font: "13px var(--font-sans)",
          color: "var(--color-text)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}>
          {WHATSAPP_TEMPLATES[activeKey](config)}
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

      {/* Side Panel — Coupon Selection */}
      <SidePanel
        isOpen={panelOpen === "coupon"}
        title="Vincular Cupom"
        onClose={() => setPanelOpen(null)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            Selecione o cupom que será enviado na mensagem WhatsApp de recuperação.
          </div>

          {coupons.length === 0 ? (
            <div style={{ padding: "24px 16px", textAlign: "center", font: "13px var(--font-sans)", color: "var(--color-text-faint)" }}>
              Nenhum cupom ativo. Crie um cupom na aba Cupons primeiro.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {coupons.map((c) => {
                const isSelected = config.coupon_code === c.code;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      saveConfig({ coupon_code: c.code });
                      setPanelOpen(null);
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
                        {c.type === "percent" ? `${c.value}% off` : `R$ ${c.value} off`}
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
            <div style={{ padding: "24px 16px", textAlign: "center", font: "13px var(--font-sans)", color: "var(--color-text-faint)" }}>
              Nenhuma regra configurada. Crie regras em Configurações de IA → Regras.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rules.map((r) => {
                const isSelected = config.rule_id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      saveConfig({ rule_id: r.id });
                      setPanelOpen(null);
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
