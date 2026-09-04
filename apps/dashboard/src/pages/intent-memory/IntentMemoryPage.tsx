import React, { useState } from "react";
import { Brain, Target, Sparkles, Activity, TrendingUp } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { StatCard } from "../overview/components/StatCard.js";
import { useIntentMemoryPage } from "./useIntentMemoryPage.js";

export interface IntentMemoryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const INTENT_LABELS: Record<string, string> = {
  price_sensitive: "Sensível a preço",
  ready_to_buy: "Pronto para comprar",
  speed_focused: "Focado em velocidade",
  browsing: "Navegando",
  exploring: "Explorando",
};

const INTENT_COLORS: Record<string, string> = {
  price_sensitive: "var(--color-warning)",
  ready_to_buy: "var(--color-success)",
  speed_focused: "var(--color-brand)",
  browsing: "var(--color-brand)",
  exploring: "var(--color-text-faint)",
};

const INTENT_DESCRIPTIONS: Record<string, string> = {
  price_sensitive:
    "Compradores que pedem cupom ou reclamam do frete. Respondem a descontos, frete grátis e ofertas com limite de tempo.",
  ready_to_buy:
    "Compradores que iniciaram e concluíram o checkout com fluidez. Preserve margem — não é necessário descontar.",
  speed_focused:
    "Compradores que escolhem frete expresso e checkout enxuto. Ofereça entrega rápida e reduza etapas do funil.",
  browsing:
    "Compradores que demonstram hesitação (saída iminente ou inatividade). Use gatilhos de retenção.",
  exploring:
    "Perfis ainda sem sinal dominante. Continuam aprendendo conforme mais sessões acontecem.",
};

// Human-readable labels for the classifier's pain-point codes.
const PAIN_POINT_LABELS: Record<string, string> = {
  shipping_cost: "Preço do frete",
  price: "Preço do produto",
  payment_friction: "Dificuldade no pagamento",
  trust: "Confiança na loja",
  hesitation: "Indecisão",
};

const EXAMPLE_BUYER = {
  intent: "price_sensitive" as const,
  preview:
    '"Vi um cupom de 10% que expirava em 2h — fechei a compra na hora, senão ia abandonar."',
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function IntentMemoryPage(props: IntentMemoryPageProps) {
  const vm = useIntentMemoryPage({ me: props.me });
  const [tab, setTab] = useState<"overview" | "signals">("overview");

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Memória de Intenção</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  const total = Object.values(vm.distribution).reduce((a, b) => a + b, 0);
  const distTotal = total || 1; // divisor guard only — never shown as a count
  const dominant = Object.entries(vm.distribution).sort((a, b) => b[1] - a[1])[0];
  const dominantCount = dominant?.[1] ?? 0;
  const dominantKey = dominantCount > 0 ? (dominant?.[0] ?? "exploring") : null;
  const trackedSessions = vm.config.intent_tracking_enabled ? total : 0;

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1 style={{ color: "var(--color-brand)" }}>Memória de Intenção</h1>
          <p className="page-lead">Descubra o que cada cliente valoriza — preço, rapidez ou confiança — e deixe o agente adaptar a conversa para vender mais.</p>
        </div>
      </header>

      {/* Explanation */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        font: "13px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.65,
      }}>
        <strong style={{ color: "var(--color-text)" }}>O que é a Memória de Intenção?</strong>
        <br />Enquanto o cliente conversa e compra, o sistema aprende o que motiva a compra dele. Com isso, o agente sabe se deve oferecer um desconto, destacar a entrega rápida ou reforçar a segurança — em vez de tratar todo mundo igual.
        <div style={{ marginTop: 10 }}>
          <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong>
          <ol style={{ margin: "6px 0 0 18px", padding: 0, lineHeight: 1.6 }}>
            <li>Observamos o comportamento durante a conversa (só com autorização do cliente, conforme a LGPD).</li>
            <li>Identificamos o perfil de compra entre 5 tipos.</li>
            <li>O agente usa o perfil para escolher a mensagem, a oferta e o melhor momento de fechar a venda.</li>
          </ol>
        </div>
      </div>

      {/* Toggle Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", marginBottom: 4 }}>
              Identificar o perfil dos clientes
            </div>
            <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>
              {vm.config.intent_tracking_enabled
                ? "Ativo. O agente adapta a conversa ao perfil de cada cliente (com autorização, conforme a LGPD)."
                : "Desativado. Ative para o agente personalizar cada conversa conforme o perfil do cliente."}
            </div>
          </div>
          <ToggleSwitch
            checked={vm.config.intent_tracking_enabled}
            onChange={vm.handleToggleTracking}
            disabled={vm.saving}
          />
        </div>
      </div>

      {/* KPI Stats — using official StatCard from overview */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard
          icon={<Brain size={16} />}
          value={trackedSessions}
          label="Clientes analisados"
          accent="var(--color-brand)"
        />
        <StatCard
          icon={<Target size={16} />}
          value={dominantKey ? (INTENT_LABELS[dominantKey] ?? "—") : "—"}
          label="Perfil mais comum"
          accent="var(--color-brand)"
        />
        <StatCard
          icon={<Sparkles size={16} />}
          value={`${vm.config.intent_tracking_enabled ? Object.keys(vm.distribution).filter((k) => vm.distribution[k as keyof typeof vm.distribution] > 0).length : 0}/5`}
          label="Perfis identificados"
        />
        <StatCard
          icon={<Activity size={16} />}
          value={vm.signals.length}
          label="Clientes com perfil"
          accent="var(--color-success)"
        />
      </div>

      {/* Tabs */}
      <TabBar
        tabs={[
          { key: "overview", label: "Visão geral" },
          { key: "signals", label: `Atividade recente (${vm.signals.length})` },
        ]}
        activeTab={tab}
        onTabChange={(k) => setTab(k as "overview" | "signals")}
      />

      {tab === "overview" && (
      <>

      {/* Analytics Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader title="Perfis dos seus clientes" variant="secondary" />

        {vm.loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
            Carregando dados...
          </div>
        ) : !vm.config.intent_tracking_enabled ? (
          <div style={{
            padding: "40px 24px",
            textAlign: "center",
            background: "var(--accent-soft)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--accent-line)",
          }}>
            <Brain size={32} color="var(--color-brand)" style={{ margin: "0 auto 12px" }} />
            <div style={{ font: "14px var(--font-sans)", color: "var(--color-brand)", marginBottom: 8 }}>
              Memória de Intenção desativada
            </div>
            <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 16 }}>
              Ative para o agente começar a entender e personalizar cada conversa
            </div>
            <Button variant="primary" size="sm" onClick={() => vm.handleToggleTracking(true)}>
              Ativar agora
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.entries(vm.distribution).map(([key, count]) => (
              <div key={key}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                    {INTENT_LABELS[key] || key}
                  </span>
                  <span style={{ font: "600 13px var(--font-mono)", color: INTENT_COLORS[key] }}>
                    {count} ({((count / distTotal) * 100).toFixed(0)}%)
                  </span>
                </div>
                <div style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--color-border)",
                  overflow: "hidden",
                }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${(count / distTotal) * 100}%`,
                      background: INTENT_COLORS[key],
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-profile playbook */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader
          title="Como cada perfil deve ser abordado"
          subtitle="Sugestões de copy, oferta e gatilho por tipo de intenção."
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {Object.entries(INTENT_DESCRIPTIONS).map(([key, desc]) => (
            <div key={key} style={{
              padding: "14px 16px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--surface-1)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: INTENT_COLORS[key],
                }} />
                <span style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  {INTENT_LABELS[key]}
                </span>
              </div>
              <p style={{ margin: 0, font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.55 }}>
                {desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Example scenario + Recent signals */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="panel" style={{ padding: "20px 24px" }}>
          <SectionHeader title="Exemplo real" variant="secondary" />
          <div style={{
            padding: "12px 14px",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface-1)",
            border: "1px solid var(--color-border)",
            font: "13px var(--font-sans)",
            color: "var(--color-text)",
            marginBottom: 10,
          }}>
            {EXAMPLE_BUYER.preview}
          </div>
          <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            Perfil detectado:{" "}
            <strong style={{ color: INTENT_COLORS[EXAMPLE_BUYER.intent] }}>
              {INTENT_LABELS[EXAMPLE_BUYER.intent]}
            </strong>
            . Como o cliente demonstrou que buscava preço, o agente ofereceu um cupom por tempo limitado.
            Resultado: a compra fechou em 1min12 (a média é 6min40).
          </div>
        </div>

        <div className="panel" style={{ padding: "20px 24px" }}>
          <SectionHeader title="Atividade recente" variant="secondary" />
          {!vm.config.intent_tracking_enabled ? (
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
              Ative para ver os perfis dos clientes mais recentes.
            </div>
          ) : vm.signals.length === 0 ? (
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
              Nenhum cliente com perfil ainda. Os perfis aparecem depois das primeiras conversas (com autorização do cliente).
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {vm.signals.slice(0, 5).map((s, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, font: "12px var(--font-sans)" }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: INTENT_COLORS[s.intent] ?? "var(--color-text-faint)",
                    flex: "none",
                  }} />
                  <span style={{ color: "var(--color-text)", flex: 1 }}>
                    {INTENT_LABELS[s.intent] ?? s.intent}
                    {s.pain_points.length > 0 ? ` — ${s.pain_points.map((p) => PAIN_POINT_LABELS[p] ?? p).join(", ")}` : ""}
                  </span>
                  <span style={{ color: "var(--color-text-faint)", font: "11px var(--font-mono)" }}>{relativeTime(s.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Where to see results */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--surface-1)",
        border: "1px solid var(--color-border)",
        font: "13px var(--font-sans)",
        color: "var(--color-text-muted)",
        lineHeight: 1.6,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}>
        <TrendingUp size={16} color="var(--color-brand)" style={{ flex: "none", marginTop: 2 }} />
        <div>
          <strong style={{ color: "var(--color-text)" }}>Onde ver o resultado:</strong>{" "}
          o agente adapta cada conversa ao perfil do cliente. Compare quantas vendas fecham com clientes que já têm perfil
          contra os que ainda não têm na aba <em>Observações</em> do Gerente de Receita.
        </div>
      </div>

      {/* Privacy Note */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-brand-subtle)",
        border: "1px solid var(--color-brand-ring)",
        font: "12px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.6,
      }}>
        <strong>Privacidade e LGPD:</strong> os perfis só são criados com a autorização do cliente.
        Todos os dados ficam guardados de forma segura, com acesso restrito.
      </div>
      </>
      )}

      {/* Signals Tab */}
      {tab === "signals" && (
        <DataPanel
          title="Clientes com perfil identificado"
          isEmpty={vm.signals.length === 0}
          empty={{ icon: Brain, title: "Nenhum cliente com perfil ainda", description: "Os perfis aparecem depois de pedidos concluídos, com autorização do cliente." }}
        >
          {vm.signals.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Perfil</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Urgência</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Orçamento</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Preocupações</th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", letterSpacing: "0.04em", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {vm.signals.map((s, i) => (
                    <tr key={i} style={{ borderBottom: i < vm.signals.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                      <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: INTENT_COLORS[s.intent] ?? "var(--color-brand)", flexShrink: 0 }} />
                          {INTENT_LABELS[s.intent] ?? s.intent}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: s.urgency === "high" ? "var(--color-error-bg)" : s.urgency === "medium" ? "var(--color-warning-bg)" : "var(--surface-2)", color: s.urgency === "high" ? "var(--color-error)" : s.urgency === "medium" ? "var(--color-warning)" : "var(--color-text-faint)" }}>
                          {s.urgency === "high" ? "Alta" : s.urgency === "medium" ? "Média" : "Baixa"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <span style={{ padding: "2px 8px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: s.budget === "premium" ? "var(--color-success-bg)" : s.budget === "mid" ? "var(--color-warning-bg)" : "var(--surface-2)", color: s.budget === "premium" ? "var(--color-success)" : s.budget === "mid" ? "var(--color-warning)" : "var(--color-text-faint)" }}>
                          {s.budget === "premium" ? "Premium" : s.budget === "mid" ? "Médio" : "Econômico"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px", font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                        {s.pain_points.length > 0 ? s.pain_points.map((p) => PAIN_POINT_LABELS[p] ?? p).join(", ") : "—"}
                      </td>
                      <td style={{ padding: "12px 20px", font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>
                        {new Date(s.created_at).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataPanel>
      )}
    </div>
  );
}
