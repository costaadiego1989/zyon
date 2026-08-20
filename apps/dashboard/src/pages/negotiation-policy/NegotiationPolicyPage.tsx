import React from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useNegotiationPolicyPage } from "./useNegotiationPolicyPage.js";

export interface NegotiationPolicyPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  font: "13px var(--sans)",
};

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  font: "600 11px var(--mono)",
  letterSpacing: "0.04em",
  color: "var(--faint)",
};

const TD_STYLE: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
  color: "var(--ink)",
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
          <h1>Negotiation Policy</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <span className="eyebrow">CHECKOUT</span>
        <h1>Política de Negociação</h1>
        <p className="page-lead">Configure os limites de desconto e gerencie tentativas de negociação</p>
      </div>

      {/* Policy Config Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ font: "600 14px var(--sans)", color: "var(--ink)" }}>Negociação</div>
            <div style={{ font: "13px var(--sans)", color: "var(--muted)", marginTop: 4 }}>
              {vm.policy.negotiation_enabled ? "Negociação habilitada" : "Negociação desabilitada"}
            </div>
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
                <label style={{ font: "12px var(--sans)", color: "var(--muted)", display: "block", marginBottom: 6 }}>
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
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    font: "13px var(--mono)",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ font: "12px var(--sans)", color: "var(--muted)", display: "block", marginBottom: 6 }}>
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
                    borderRadius: 7,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--ink)",
                    font: "13px var(--mono)",
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
              <div style={{ padding: "12px 16px", background: "var(--accent-soft)", borderRadius: 8 }}>
                <div style={{ font: "11px var(--mono)", color: "var(--faint)", marginBottom: 4 }}>MÍNIMO</div>
                <div style={{ font: "600 18px var(--mono)", color: "var(--accent)" }}>
                  {vm.policy.min_discount_percent}%
                </div>
              </div>
              <div style={{ padding: "12px 16px", background: "var(--accent-soft)", borderRadius: 8 }}>
                <div style={{ font: "11px var(--mono)", color: "var(--faint)", marginBottom: 4 }}>MÁXIMO</div>
                <div style={{ font: "600 18px var(--mono)", color: "var(--accent)" }}>
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <BarChart3 size={16} color="var(--accent)" />
          <span style={{ font: "600 14px var(--sans)", color: "var(--ink)" }}>
            Últimas tentativas de negociação
          </span>
        </div>

        {vm.loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>
            Carregando...
          </div>
        ) : vm.attempts.length === 0 ? (
          <div style={{
            padding: "40px 24px",
            textAlign: "center",
            background: "var(--accent-soft)",
            borderRadius: 12,
            border: "1px solid var(--accent-line)",
          }}>
            <BarChart3 size={32} color="var(--accent)" style={{ margin: "0 auto 12px" }} />
            <div style={{ font: "14px var(--sans)", color: "var(--accent)" }}>
              Nenhuma tentativa registrada
            </div>
            <div style={{ font: "13px var(--sans)", color: "var(--muted)", marginTop: 6 }}>
              As tentativas aparecerão aqui conforme os agentes negociam com os clientes
            </div>
          </div>
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
                        <code style={{ font: "11px var(--mono)" }}>{attempt.session_id.slice(0, 8)}…</code>
                      </td>
                      <td style={TD_STYLE}>
                        <span style={{ font: "600 13px var(--mono)", color: "var(--warn)" }}>
                          {attempt.discount_percent}%
                        </span>
                      </td>
                      <td style={TD_STYLE}>{attempt.scope}</td>
                      <td style={TD_STYLE}>
                        <span style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          font: "600 10px var(--mono)",
                          background: attempt.result === "accepted" ? "var(--good-soft)" : attempt.result === "rejected" ? "var(--danger-soft)" : "var(--warn-soft)",
                          color: attempt.result === "accepted" ? "var(--good)" : attempt.result === "rejected" ? "var(--danger)" : "var(--warn)",
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
