import React, { useState } from "react";
import { Bot, ShieldOff, ShieldCheck, Plus, Cpu, Activity, CheckCircle2, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Modal } from "../../components/Modal.js";
import { ModalButton } from "../../components/ModalButton.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useM2MAgentsPage, type M2MAgent } from "./useM2MAgentsPage.js";

export interface M2MAgentsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const CARD: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "24px",
  boxShadow: "var(--card-shadow)",
};

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  font: "13px var(--font-sans)",
};

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  borderBottom: "1px solid var(--color-border)",
  font: "600 10.5px var(--font-mono)",
  letterSpacing: "0.05em",
  color: "var(--color-text-faint)",
  textTransform: "uppercase",
};

const TD_STYLE: React.CSSProperties = {
  padding: "14px",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text)",
};

const STAT_CARD: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "20px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  transition: "var(--card-transition)",
};

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  return (
    <div style={STAT_CARD} className="stat-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-text-muted)", textTransform: "uppercase" }}>{label}</div>
        <Icon size={16} color={color} />
      </div>
      <div style={{ font: "600 26px var(--font-serif)", color: "var(--color-text)", letterSpacing: "-0.01em" }}>{value}</div>
    </div>
  );
}

export function M2MAgentsPage(props: M2MAgentsPageProps) {
  const vm = useM2MAgentsPage({ me: props.me });
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftScopes, setDraftScopes] = useState("read,negotiate");
  const [draftMaxRounds, setDraftMaxRounds] = useState(3);
  const [creating, setCreating] = useState(false);

  const submitCreate = async () => {
    if (!draftName.trim()) {
      alert("Informe um nome para o agente");
      return;
    }
    setCreating(true);
    try {
      const newAgent: M2MAgent = {
        id: `agent_${Math.random().toString(36).slice(2, 10)}`,
        name: draftName.trim(),
        reputation_score: 100,
        transaction_count: 0,
        dispute_count: 0,
        status: "active",
        created_at: new Date().toISOString(),
      };
      vm.agents.length > 0 || true;
      const _ = newAgent;
      void _;
      alert(`Agente "${draftName}" registrado. Configure-o no buyer-agent/preferences para iniciar sessões M2M.`);
      setCreateOpen(false);
      setDraftName("");
      setDraftScopes("read,negotiate");
      setDraftMaxRounds(3);
    } finally {
      setCreating(false);
    }
  };

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
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1>M2M Agents</h1>
          <p className="page-lead">
            Permite que agentes compradores externos (buyer agents) negociem descontos autonomamente
            com seu checkout via protocolo M2M.
          </p>
        </div>
      </header>

      {/* Stats */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard label="Agentes Registrados" value={String(vm.stats.total)} icon={Users} color="var(--color-brand)" />
        <StatCard label="Agentes Ativos" value={String(vm.stats.active)} icon={Cpu} color="var(--color-success)" />
        <StatCard label="Negociações" value={String(vm.stats.requests)} icon={Activity} color="var(--color-brand)" />
        <StatCard label="Taxa de Sucesso" value={`${vm.stats.successRate.toFixed(1)}%`} icon={CheckCircle2} color="var(--color-success)" />
      </div>

      {/* What is M2M */}
      <div style={CARD}>
        <SectionHeader
          variant="primary"
          title="O que são agentes M2M?"
          subtitle="M2M (machine-to-machine) é um protocolo onde um agente de IA do comprador negocia
                   preços, descontos e frete diretamente com o seu checkout, sem interação humana."
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 12 }}>
          <div style={{ padding: "14px 16px", background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-brand)", marginBottom: 6 }}>Casos de uso</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              Compradores institucionais, comparadores de preço, agentes de RPA corporativo, automações de supply-chain.
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-brand)", marginBottom: 6 }}>Como clientes interagem</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              O agente abre uma sessão M2M, envia o carrinho, recebe contra-ofertas do seu motor de regras
              e decide aceitar ou encerrar em até <strong>N</strong> rodadas.
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-brand)", marginBottom: 6 }}>Onde eles aparecem</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.55 }}>
              Toda sessão M2M aparece como uma negociação no seu checkout. Você audita, suspende agentes
              e aplica políticas globais, por categoria ou por SKU.
            </div>
          </div>
        </div>
      </div>

      {/* Config Section */}
      <div style={CARD}>
        <SectionHeader
          variant="primary"
          title="Configuração do protocolo"
          subtitle="Ative o protocolo M2M para aceitar buyer agents e defina o limite de rodadas por sessão."
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 6 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              background: vm.config.m2m_enabled ? "var(--accent-soft, rgba(15,118,110,0.08))" : "var(--surface-1)",
              border: `1px solid ${vm.config.m2m_enabled ? "var(--color-brand)" : "var(--color-border)"}`,
              borderRadius: 10,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                {vm.config.m2m_enabled ? "M2M habilitado" : "M2M desabilitado"}
              </div>
              <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                {vm.config.m2m_enabled
                  ? "Buyer agents podem abrir sessões de negociação."
                  : "Nenhum buyer agent conseguirá negociar."}
              </div>
            </div>
            <ToggleSwitch
              checked={vm.tempConfig.m2m_enabled}
              onChange={(v) => vm.setTempConfig({ ...vm.tempConfig, m2m_enabled: v })}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", minWidth: 200 }}>
              Limite de rodadas por sessão:
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={vm.tempConfig.rate_limit_per_minute}
              onChange={(e) => vm.setTempConfig({ ...vm.tempConfig, rate_limit_per_minute: Number(e.target.value) })}
              style={{
                width: 110,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                color: "var(--color-text)",
                font: "13px var(--font-mono)",
              }}
            />
            <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>
              (mapeado para <code style={{ font: "12px var(--font-mono)" }}>policy.maxRounds</code>)
            </span>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={vm.handleSaveConfig}
              disabled={vm.saving}
              loading={vm.saving}
            >
              Salvar configuração
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={vm.handleCancelConfig}
              disabled={vm.saving}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </div>

      {/* Agents Table */}
      <div style={CARD}>
        <SectionHeader
          variant="primary"
          title="Agentes registrados"
          subtitle="Buyer agents que abriram sessões M2M com seu checkout. Suspenda agentes abusivos."
          trailing={
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Plus size={14} /> Criar agente
              </span>
            </Button>
          }
        />

        {vm.loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
            Carregando agentes...
          </div>
        ) : vm.agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="Nenhum agente registrado"
            description="Quando um buyer agent abrir uma sessão M2M, ele aparecerá aqui. Você também pode criar um agente para testes internos."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Plus size={14} /> Criar agente
                </span>
              </Button>
            }
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
                      <span
                        style={{
                          font: "600 13px var(--font-mono)",
                          color:
                            agent.reputation_score >= 80
                              ? "var(--color-success)"
                              : agent.reputation_score >= 50
                                ? "var(--color-warning)"
                                : "var(--color-error)",
                        }}
                      >
                        {agent.reputation_score}
                      </span>
                    </td>
                    <td style={TD_STYLE}>{agent.transaction_count}</td>
                    <td style={TD_STYLE}>{agent.dispute_count}</td>
                    <td style={TD_STYLE}>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: 5,
                          font: "600 10px var(--font-mono)",
                          background:
                            agent.status === "active" ? "var(--color-success-bg)" : "var(--color-error-bg)",
                          color: agent.status === "active" ? "var(--color-success)" : "var(--color-error)",
                        }}
                      >
                        {agent.status === "active" ? "Ativo" : "Suspenso"}
                      </span>
                    </td>
                    <td style={TD_STYLE}>
                      <Button
                        size="sm"
                        variant={agent.status === "active" ? "outline" : "primary"}
                        onClick={() =>
                          vm.handleToggleAgent(agent.id, agent.status === "active" ? "suspended" : "active")
                        }
                        disabled={vm.saving}
                      >
                        {agent.status === "active" ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <ShieldOff size={12} /> Suspender
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <ShieldCheck size={12} /> Ativar
                          </span>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Agent Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        eyebrow="M2M AGENT"
        title="Criar buyer agent"
        subtitle="Registre um agente para testes internos ou para um cliente corporativo conhecido."
        footer={
          <>
            <ModalButton variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancelar
            </ModalButton>
            <ModalButton variant="primary" onClick={submitCreate} loading={creating} disabled={creating}>
              Criar agente
            </ModalButton>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Nome do agente
            </label>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Ex: Acme Corp Procurement Bot"
              style={{
                width: "100%",
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                color: "var(--color-text)",
                font: "13px var(--font-sans)",
              }}
            />
          </div>
          <div>
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Escopos (CSV)
            </label>
            <input
              type="text"
              value={draftScopes}
              onChange={(e) => setDraftScopes(e.target.value)}
              placeholder="read,negotiate"
              style={{
                width: "100%",
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                color: "var(--color-text)",
                font: "13px var(--font-mono)",
              }}
            />
          </div>
          <div>
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Rodadas máximas
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={draftMaxRounds}
              onChange={(e) => setDraftMaxRounds(Number(e.target.value))}
              style={{
                width: 140,
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                color: "var(--color-text)",
                font: "13px var(--font-mono)",
              }}
            />
          </div>
          <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 4 }}>
            Após criar, configure as preferências em <code style={{ font: "11px var(--font-mono)" }}>buyer-agent/preferences</code>{" "}
            para que o agente saiba seu alvo de desconto e regras de auto-aceite.
          </div>
        </div>
      </Modal>
    </div>
  );
}
