import React from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { EmptyState } from "../../components/EmptyState.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { useNegotiationPolicyPage } from "./useNegotiationPolicyPage.js";

export interface NegotiationPolicyPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  font: "13px var(--font-sans)",
};

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  borderBottom: "1px solid var(--color-border)",
  font: "600 11px var(--font-mono)",
  letterSpacing: "0.04em",
  color: "var(--color-text-faint)",
};

const TD_STYLE: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text)",
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function NegotiationPolicyPage(props: NegotiationPolicyPageProps) {
  const vm = useNegotiationPolicyPage({ me: props.me });
  const [expandedAttempt, setExpandedAttempt] = React.useState<string | null>(null);

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Checkout</span>
          <h1>Política de Negociação</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Checkout</span>
          <h1>Política de Negociação</h1>
          <p className="page-lead">Configure os limites de desconto e gerencie tentativas de negociação</p>
        </div>
      </header>

      {/* Priority Warning */}
      <div role="note" style={{ backgroundColor: "#fef3c7", borderLeft: "4px solid #f59e0b", padding: "12px 16px", borderRadius: 6, font: "13px var(--font-sans)", color: "#92400e" }}>
        <strong>Aviso:</strong> Negociação dinâmica tem prioridade sobre desconto progressivo. Quando uma negociação M2M ou Deal Engine autoriza uma oferta, o progressivo é ignorado para essa sessão.
      </div>

      {/* Policy Config Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: 1 }}>
            <SectionHeader
              variant="secondary"
              title="Negociação"
            />
          </div>
          <ToggleSwitch
            checked={vm.tempPolicy.negotiation_enabled}
            onChange={(v) => vm.setTempPolicy({ ...vm.tempPolicy, negotiation_enabled: v })}
          />
        </div>

        {vm.isEditingPolicy ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", display: "block", marginBottom: 6 }}>
                  Desconto mínimo (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={vm.tempPolicy.min_discount_percent}
                  onChange={(e) =>
                    vm.setTempPolicy({ ...vm.tempPolicy, min_discount_percent: Number(e.target.value) })
                  }
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    background: "var(--surface-1)",
                    color: "var(--color-text)",
                    font: "13px var(--font-mono)",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", display: "block", marginBottom: 6 }}>
                  Desconto máximo (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={vm.tempPolicy.max_discount_percent}
                  onChange={(e) =>
                    vm.setTempPolicy({ ...vm.tempPolicy, max_discount_percent: Number(e.target.value) })
                  }
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border)",
                    background: "var(--surface-1)",
                    color: "var(--color-text)",
                    font: "13px var(--font-mono)",
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="primary" size="sm" onClick={vm.handleSavePolicy} disabled={vm.saving}>
                Salvar
              </Button>
              <Button variant="ghost" size="sm" onClick={vm.handleCancelPolicy} disabled={vm.saving}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={{ padding: "12px 16px", background: "var(--accent-soft)", borderRadius: "var(--radius-sm)" }}>
                <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", marginBottom: 4 }}>MÍNIMO</div>
                <div style={{ font: "600 18px var(--font-mono)", color: "var(--color-brand)" }}>
                  {vm.policy.min_discount_percent}%
                </div>
              </div>
              <div style={{ padding: "12px 16px", background: "var(--accent-soft)", borderRadius: "var(--radius-sm)" }}>
                <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", marginBottom: 4 }}>MÁXIMO</div>
                <div style={{ font: "600 18px var(--font-mono)", color: "var(--color-brand)" }}>
                  {vm.policy.max_discount_percent}%
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => vm.setIsEditingPolicy(true)}>
              Editar política
            </Button>
          </div>
        )}
      </div>

      {/* Recent Attempts */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader
          variant="secondary"
          title="Últimas tentativas de negociação"
        />

        {vm.loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
            Carregando...
          </div>
        ) : vm.attempts.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="Nenhuma tentativa registrada"
            description="As tentativas aparecerão aqui conforme os agentes negociam com os clientes"
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={TH_STYLE}></th>
                  <th style={TH_STYLE}>Sessão</th>
                  <th style={TH_STYLE}>Desconto</th>
                  <th style={TH_STYLE}>Escopo</th>
                  <th style={TH_STYLE}>Resultado</th>
                  <th style={TH_STYLE}>Data</th>
                </tr>
              </thead>
              <tbody>
                {vm.attempts.map((attempt) => (
                  <React.Fragment key={attempt.id}>
                    <tr onClick={() => setExpandedAttempt(expandedAttempt === attempt.id ? null : attempt.id)} style={{ cursor: "pointer" }}>
                      <td style={TD_STYLE}>
                        {expandedAttempt === attempt.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                      <td style={TD_STYLE}>
                        <code style={{ font: "11px var(--font-mono)" }}>{attempt.session_id.slice(0, 8)}…</code>
                      </td>
                      <td style={TD_STYLE}>
                        <span style={{ font: "600 13px var(--font-mono)", color: "var(--color-warning)" }}>
                          {attempt.discount_percent}%
                        </span>
                      </td>
                      <td style={TD_STYLE}>{attempt.scope}</td>
                      <td style={TD_STYLE}>
                        <span style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          font: "600 10px var(--font-mono)",
                          background: attempt.result === "accepted" ? "var(--good-soft)" : attempt.result === "rejected" ? "var(--danger-soft)" : "var(--warn-soft)",
                          color: attempt.result === "accepted" ? "var(--color-success)" : attempt.result === "rejected" ? "var(--color-error)" : "var(--color-warning)",
                        }}>
                          {attempt.result === "accepted" ? "Aceito" : attempt.result === "rejected" ? "Rejeitado" : "Pendente"}
                        </span>
                      </td>
                      <td style={TD_STYLE}>{formatDate(attempt.created_at)}</td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
