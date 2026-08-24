import React, { useState } from "react";
import { Bot } from "lucide-react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { EmptyState } from "../../../components/EmptyState.js";
import type { M2MAgentResponse } from "../../../api/endpoints/m2m-management.js";

interface AgentsTabProps {
  agents: M2MAgentResponse[];
  loading: boolean;
  saving: boolean;
  onCreate: (data: { displayName: string; globalUserId: string }) => Promise<void>;
  onSuspend: (agentId: string, suspend: boolean) => Promise<void>;
}

export function AgentsTab({ agents, loading, saving, onCreate, onSuspend }: AgentsTabProps) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");

  async function handleSubmit() {
    if (!name.trim() || !userId.trim()) return;
    await onCreate({ displayName: name.trim(), globalUserId: userId.trim() });
    setName("");
    setUserId("");
    setShowForm(false);
  }

  return (
    <div className="panel">
      <SectionHeader
        variant="secondary"
        title="Agentes Registrados"
        trailing={
          <button
            type="button"
            className="zyn-btn zyn-btn--primary"
            onClick={() => setShowForm(!showForm)}
            style={{ fontSize: 12, padding: "6px 14px" }}
          >
            + Novo agente
          </button>
        }
      />

      {showForm && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, marginBottom: 16, alignItems: "flex-end" }}>
          <div>
            <label style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bot Procurement"
              style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-sans)" }}
            />
          </div>
          <div>
            <label style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Global User ID</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="agent-procurement-001"
              style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-mono)" }}
            />
          </div>
          <button type="button" className="zyn-btn zyn-btn--primary" onClick={handleSubmit} disabled={saving} style={{ padding: "10px 20px" }}>
            Criar
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando...</div>
      ) : agents.length === 0 ? (
        <EmptyState icon={Bot} title="Nenhum agente registrado" description="Crie um agente para permitir checkout programático via API" />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="fnl-sessions-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Status</th>
                <th>Transações</th>
                <th>Reputação</th>
                <th>Criado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td style={{ font: "500 13px var(--font-sans)" }}>{agent.displayName}</td>
                  <td>
                    <span style={{
                      display: "inline-block",
                      padding: "3px 10px",
                      borderRadius: "var(--radius-full)",
                      font: "600 10px var(--font-mono)",
                      background: agent.status === "active" ? "var(--color-success-bg)" : "var(--color-error-bg)",
                      color: agent.status === "active" ? "var(--color-success)" : "var(--color-error)",
                    }}>
                      {agent.status === "active" ? "Ativo" : "Suspenso"}
                    </span>
                  </td>
                  <td style={{ font: "600 13px var(--font-data)", color: "var(--color-text-muted)" }}>{agent.reputation?.transactionCount ?? 0}</td>
                  <td style={{ font: "600 13px var(--font-data)", color: "var(--color-brand)" }}>{agent.reputation?.reputationScore ?? 0}%</td>
                  <td style={{ font: "12px var(--font-data)", color: "var(--color-text-muted)" }}>
                    {new Date(agent.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onSuspend(agent.id, agent.status === "active")}
                      style={{ font: "500 11px var(--font-sans)", padding: "5px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", color: "var(--color-text-muted)", cursor: "pointer" }}
                    >
                      {agent.status === "active" ? "Suspender" : "Reativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
