import React from "react";
import { Bot, ShieldOff, ShieldCheck } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useM2MAgentsPage } from "./useM2MAgentsPage.js";

export interface M2MAgentsPageProps {
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

export function M2MAgentsPage(props: M2MAgentsPageProps) {
  const vm = useM2MAgentsPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>M2M Agents</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div>
        <span className="eyebrow">INTELIGÊNCIA IA</span>
        <h1>M2M Agents</h1>
        <p className="page-lead">Gerencie agentes externos que interagem com seu checkout via protocolo M2M</p>
      </div>

      {/* Config Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ font: "600 14px var(--sans)", color: "var(--ink)" }}>Configurações M2M</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ToggleSwitch
              checked={vm.config.m2m_enabled}
              onChange={(v) => vm.setTempConfig({ ...vm.tempConfig, m2m_enabled: v })}
            />
            <span style={{ font: "13px var(--sans)", color: "var(--ink)" }}>
              {vm.config.m2m_enabled ? "M2M habilitado" : "M2M desabilitado"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ font: "12px var(--sans)", color: "var(--muted)", minWidth: 140 }}>
              Rate limit (req/min):
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={vm.tempConfig.rate_limit_per_minute}
              onChange={(e) => vm.setTempConfig({ ...vm.tempConfig, rate_limit_per_minute: Number(e.target.value) })}
              style={{
                width: 90,
                padding: "6px 10px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--ink)",
                font: "13px var(--mono)",
              }}
            />
          </div>
          <div>
            <Button variant="primary" size="sm" onClick={vm.handleSaveConfig} disabled={vm.saving}>
              Salvar configuração
            </Button>
          </div>
        </div>
      </div>

      {/* Agents Table */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ font: "600 14px var(--sans)", color: "var(--ink)", marginBottom: 16 }}>Agentes registrados</div>

        {vm.loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>
            Carregando agentes...
          </div>
        ) : vm.agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="Nenhum agente registrado"
            description="Buyer agents se registram via API. Quando um agente externo iniciar uma sessão M2M, ele aparecerá aqui."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Nome</th>
                  <th style={TH_STYLE}>Reputação</th>
                  <th style={TH_STYLE}>Transações</th>
                  <th style={TH_STYLE}>Disputas</th>
                  <th style={TH_STYLE}>Status</th>
                  <th style={TH_STYLE}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {vm.agents.map((agent) => (
                  <tr key={agent.id}>
                    <td style={TD_STYLE}>{agent.name}</td>
                    <td style={TD_STYLE}>
                      <span style={{ font: "600 13px var(--mono)", color: agent.reputation_score >= 80 ? "var(--good)" : agent.reputation_score >= 50 ? "var(--warn)" : "var(--danger)" }}>
                        {agent.reputation_score}
                      </span>
                    </td>
                    <td style={TD_STYLE}>{agent.transaction_count}</td>
                    <td style={TD_STYLE}>{agent.dispute_count}</td>
                    <td style={TD_STYLE}>
                      <span style={{
                        padding: "3px 8px",
                        borderRadius: 5,
                        font: "600 10px var(--mono)",
                        background: agent.status === "active" ? "var(--good-soft)" : "var(--danger-soft)",
                        color: agent.status === "active" ? "var(--good)" : "var(--danger)",
                      }}>
                        {agent.status === "active" ? "Ativo" : "Suspenso"}
                      </span>
                    </td>
                    <td style={TD_STYLE}>
                      <Button
                        size="sm"
                        variant={agent.status === "active" ? "outline" : "primary"}
                        onClick={() => vm.handleToggleAgent(agent.id, agent.status === "active" ? "suspended" : "active")}
                        disabled={vm.saving}
                      >
                        {agent.status === "active" ? <><ShieldOff size={12} /> Suspender</> : <><ShieldCheck size={12} /> Ativar</>}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
