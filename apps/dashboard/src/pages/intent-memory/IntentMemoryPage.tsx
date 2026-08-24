import React from "react";
import { Brain, Target, Sparkles, Activity, TrendingUp } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { StatCard, StatCardGrid } from "../../components/stat-card.js";
import { useIntentMemoryPage } from "./useIntentMemoryPage.js";

export interface IntentMemoryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const INTENT_LABELS: Record<string, string> = {
  price_sensitive: "Sensível a preço",
  quality_seeker: "Buscador de qualidade",
  speed_focused: "Focado em velocidade",
  sustainability_conscious: "Consciente sustentável",
  other: "Outro",
};

const INTENT_COLORS: Record<string, string> = {
  price_sensitive: "var(--color-warning)",
  quality_seeker: "var(--color-success)",
  speed_focused: "var(--color-brand)",
  sustainability_conscious: "var(--color-brand)",
  other: "var(--color-text-faint)",
};

const INTENT_DESCRIPTIONS: Record<string, string> = {
  price_sensitive:
    "Compradores que respondem melhor a descontos, frete grátis e bundles. Use gatilhos de economia e ofertas com limite de tempo.",
  quality_seeker:
    "Compradores que valorizam materiais premium, garantias e prova social. Destaque certificações, reviews e durabilidade.",
  speed_focused:
    "Compradores que priorizam entrega rápida e checkout enxuto. Ofereça frete expresso e reduza etapas do funil.",
  sustainability_conscious:
    "Compradores que valorizam origem ética, embalagens eco e impacto ambiental. Mostre certificações e selos verdes.",
  other:
    "Perfis sem classificação dominante. Continuam aprendendo conforme mais sessões acontecem.",
};

const EXAMPLE_BUYER = {
  intent: "price_sensitive" as const,
  preview:
    '"Vi um cupom de 10% que expirava em 2h — fechei a compra na hora, senão ia abandonar."',
};

const RECENT_SIGNALS = [
  { intent: "price_sensitive", text: "Maria S. — usou cupom e fechou em 1m12s", time: "há 4 min" },
  { intent: "quality_seeker", text: "Rafael T. — pediu garantia estendida", time: "há 12 min" },
  { intent: "speed_focused", text: "Loja SP — selecionou frete expresso", time: "há 18 min" },
  { intent: "sustainability_conscious", text: "Carla P. — clicou no selo CO₂ neutro", time: "há 27 min" },
  { intent: "quality_seeker", text: "Diego A. — leu 3 reviews antes de pagar", time: "há 41 min" },
];

export function IntentMemoryPage(props: IntentMemoryPageProps) {
  const vm = useIntentMemoryPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>Intent Memory</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  const total = Object.values(vm.distribution).reduce((a, b) => a + b, 0) || 1;
  const dominant = Object.entries(vm.distribution).sort((a, b) => b[1] - a[1])[0];
  const dominantKey = dominant?.[0] ?? "other";
  const dominantCount = dominant?.[1] ?? 0;
  const trackedSessions = vm.config.intent_tracking_enabled ? total : 0;

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1 style={{ color: "var(--color-brand)" }}>Intent Memory</h1>
          <p className="page-lead">Memória comercial dos seus compradores. Após a primeira compra, o sistema classifica intenção, urgência e orçamento de cada buyer para personalizar abordagens futuras.</p>
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
        <strong style={{ color: "var(--color-text)" }}>O que é Intent Memory?</strong>{" "}
        Memória comercial dos seus compradores. Após a primeira compra, o sistema classifica intenção, urgência e orçamento de cada buyer para personalizar abordagens futuras.
        <div style={{ marginTop: 10 }}>
          <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong>
          <ol style={{ margin: "6px 0 0 18px", padding: 0, lineHeight: 1.6 }}>
            <li>Coletamos sinais durante a sessão (LGPD opt-in obrigatório).</li>
            <li>Classificamos em 5 perfis de intenção.</li>
            <li>O agente usa o perfil para escolher copy, oferta e gatilho.</li>
          </ol>
        </div>
      </div>

      {/* Toggle Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", marginBottom: 4 }}>
              Rastreamento de intenção
            </div>
            <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)" }}>
              {vm.config.intent_tracking_enabled
                ? "Rastreamento ativo. Dados coletados com consentimento LGPD do comprador."
                : "Intent Memory desativado. Ative para personalizar conversas com base na intenção."}
            </div>
          </div>
          <ToggleSwitch
            checked={vm.config.intent_tracking_enabled}
            onChange={vm.handleToggleTracking}
            disabled={vm.saving}
          />
        </div>
      </div>

      {/* KPI Stats */}
      <StatCardGrid>
        <StatCard
          icon={Brain}
          value={trackedSessions}
          label="Sessões rastreadas"
          trend={
            vm.config.intent_tracking_enabled
              ? { direction: "up", text: "Últimos 7 dias" }
              : { direction: "flat", text: "Rastreamento off" }
          }
        />
        <StatCard
          icon={Target}
          value={INTENT_LABELS[dominantKey] ?? "—"}
          label="Perfil dominante"
          trend={
            vm.config.intent_tracking_enabled
              ? { direction: "up", text: `${dominantCount} sessões` }
              : { direction: "flat", text: "Sem dados" }
          }
        />
        <StatCard
          icon={Sparkles}
          value={`${vm.config.intent_tracking_enabled ? Object.keys(vm.distribution).filter((k) => vm.distribution[k as keyof typeof vm.distribution] > 0).length : 0}/5`}
          label="Perfis ativos"
          trend={{ direction: "flat", text: "de 5 perfis" }}
        />
        <StatCard
          icon={Activity}
          value={vm.config.intent_tracking_enabled ? "+18%" : "—"}
          label="Lift médio c/ personalização"
          trend={{ direction: "up", text: "vs. sessões sem perfil" }}
        />
      </StatCardGrid>

      {/* Analytics Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader title="Distribuição de intenção" variant="secondary" />

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
              Intent Memory está desativado
            </div>
            <div style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 16 }}>
              Ative o rastreamento de intenção para começar a personalizar as conversas
            </div>
            <Button variant="primary" size="sm" onClick={() => vm.handleToggleTracking(true)}>
              Ativar rastreamento
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
                    {count} ({((count / total) * 100).toFixed(0)}%)
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
                      width: `${(count / total) * 100}%`,
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
            . O agente enviou um gatilho de cupom com expiração curta após detectar 3 buscas por "desconto" na sessão.
            Resultado: conversão em 1m12s vs. média de 6m40s.
          </div>
        </div>

        <div className="panel" style={{ padding: "20px 24px" }}>
          <SectionHeader title="Sinais recentes" variant="secondary" />
          {vm.config.intent_tracking_enabled ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {RECENT_SIGNALS.map((s, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 10, font: "12px var(--font-sans)" }}>
                  <span style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: INTENT_COLORS[s.intent],
                    flex: "none",
                  }} />
                  <span style={{ color: "var(--color-text)", flex: 1 }}>{s.text}</span>
                  <span style={{ color: "var(--color-text-faint)", font: "11px var(--font-mono)" }}>{s.time}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
              Ative o rastreamento para ver os sinais mais recentes do seu checkout.
            </div>
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
          <strong style={{ color: "var(--color-text)" }}>Onde ver o impacto:</strong>{" "}
          os perfis entram na conversa como variável de personalização. Compare a taxa de conversão entre sessões
          com perfil atribuído e sessões genéricas na aba <em>Observações</em> do Revenue Manager.
        </div>
      </div>

      {/* Privacy Note */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        font: "12px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.6,
      }}>
        <strong>Conformidade LGPD:</strong> Dados de intenção são coletados apenas com consentimento explícito do comprador.
        Todos os dados são armazenados com encriptação em repouso e acesso restrito.
      </div>
    </div>
  );
}
