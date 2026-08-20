import React from "react";
import { Brain } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
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
  price_sensitive: "var(--warn)",
  quality_seeker: "var(--good)",
  speed_focused: "var(--accent)",
  sustainability_conscious: "var(--accent)",
  other: "var(--faint)",
};

export function IntentMemoryPage(props: IntentMemoryPageProps) {
  const vm = useIntentMemoryPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Intent Memory</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  const total = Object.values(vm.distribution).reduce((a, b) => a + b, 0) || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <span className="eyebrow">INTELIGÊNCIA IA</span>
        <h1>Intent Memory</h1>
        <p className="page-lead">Analise como seus clientes se distribuem por perfil de intenção de compra</p>
      </div>

      {/* Toggle Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ font: "600 14px var(--sans)", color: "var(--ink)", marginBottom: 4 }}>
              Intent Memory
            </div>
            <div style={{ font: "13px var(--sans)", color: "var(--muted)" }}>
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

      {/* Analytics Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ font: "600 14px var(--sans)", color: "var(--ink)", marginBottom: 20 }}>
          Distribuição de intenção
        </div>

        {vm.loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>
            Carregando dados...
          </div>
        ) : !vm.config.intent_tracking_enabled ? (
          <div style={{
            padding: "40px 24px",
            textAlign: "center",
            background: "var(--accent-soft)",
            borderRadius: 12,
            border: "1px solid var(--accent-line)",
          }}>
            <Brain size={32} color="var(--accent)" style={{ margin: "0 auto 12px" }} />
            <div style={{ font: "14px var(--sans)", color: "var(--accent)", marginBottom: 8 }}>
              Intent Memory está desativado
            </div>
            <div style={{ font: "13px var(--sans)", color: "var(--muted)", marginBottom: 16 }}>
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
                  <span style={{ font: "13px var(--sans)", color: "var(--ink)" }}>
                    {INTENT_LABELS[key] || key}
                  </span>
                  <span style={{ font: "600 13px var(--mono)", color: INTENT_COLORS[key] }}>
                    {count} ({((count / total) * 100).toFixed(0)}%)
                  </span>
                </div>
                <div style={{
                  height: 6,
                  borderRadius: 3,
                  background: "var(--border)",
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

      {/* Privacy Note */}
      <div style={{
        padding: "16px 20px",
        borderRadius: 12,
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        font: "12px var(--sans)",
        color: "var(--accent)",
        lineHeight: 1.6,
      }}>
        <strong>Conformidade LGPD:</strong> Dados de intenção são coletados apenas com consentimento explícito do comprador.
        Todos os dados são armazenados com encriptação em repouso e acesso restrito.
      </div>
    </div>
  );
}
