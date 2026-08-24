import React, { useState } from "react";
import { Bot, Plus } from "lucide-react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { Button } from "../../../components/Button.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { StatCard } from "../../overview/components/StatCard.js";
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

  const activeCount = agents.filter((a) => a.status === "active").length;
  const totalTransactions = agents.reduce((s, a) => s + (a.reputation?.transactionCount ?? 0), 0);
  const avgReputation = agents.length > 0
    ? Math.round(agents.reduce((s, a) => s + (a.reputation?.reputationScore ?? 0), 0) / agents.length)
    : 0;

  async function handleSubmit() {
    if (!name.trim() || !userId.trim()) return;
    await onCreate({ displayName: name.trim(), globalUserId: userId.trim() });
    setName("");
    setUserId("");
    setShowForm(false);
  }

  return (
    <>
      <div className="fnl-metrics" style={{ marginBottom: "var(--space-4)" }}>
        <StatCard label="Total Agentes" value={agents.length} icon={<Bot size={16} />} />
        <StatCard label="Ativos" value={activeCount} icon={<Bot size={16} />} accent="var(--color-success)" />
        <StatCard label="Transações" value={totalTransactions} icon={<Bot size={16} />} />
        <StatCard label="Reputação Média" value={`${avgReputation}%`} icon={<Bot size={16} />} />
      </div>

      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader
          variant="secondary"
          title="Agentes Registrados"
          trailing={
            <Button variant="ghost" size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus size={12} /> Novo agente
            </Button>
          }
        />

        {showForm && (
          <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>Nome</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bot Procurement"
                style={{ width: "100%", padding: "7px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "12px var(--font-sans)" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)", display: "block", marginBottom: 4 }}>Global User ID</label>
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="agent-procurement-001"
                style={{ width: "100%", padding: "7px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "12px var(--font-sans)" }}
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleSubmit} disabled={saving}>Criar</Button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando...</div>
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
                        padding: "3px 8px",
                        borderRadius: "var(--radius-full)",
                        font: "600 10px var(--font-mono)",
                        background: agent.status === "active" ? "var(--color-success-bg)" : "var(--color-error-bg)",
                        color: agent.status === "active" ? "var(--color-success)" : "var(--color-error)",
                      }}>
                        {agent.status === "active" ? "Ativo" : "Suspenso"}
                      </span>
                    </td>
                    <td style={{ font: "13px var(--font-data)" }}>{agent.reputation?.transactionCount ?? 0}</td>
                    <td style={{ font: "13px var(--font-data)" }}>{agent.reputation?.reputationScore ?? 0}%</td>
                    <td style={{ font: "12px var(--font-data)", color: "var(--color-text-muted)" }}>
                      {new Date(agent.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSuspend(agent.id, agent.status === "active")}
                      >
                        {agent.status === "active" ? "Suspender" : "Reativar"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
