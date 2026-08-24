import React, { useState } from "react";
import { Bot } from "lucide-react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { Modal } from "../../../components/Modal.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import type { M2MAgentResponse } from "../../../api/endpoints/m2m-management.js";

interface AgentsTabProps {
  agents: M2MAgentResponse[];
  loading: boolean;
  saving: boolean;
  onCreate: (data: { displayName: string; globalUserId: string; expiresInDays?: number }) => Promise<void>;
  onSuspend: (agentId: string, suspend: boolean) => Promise<void>;
}

const PAYLOAD_EXAMPLE = `POST /m2m/negotiate
{
  "cart": {
    "items": [
      { "sku": "SKU-001", "price": 199.90, "quantity": 1 }
    ],
    "total": 199.90
  },
  "preferences": {
    "target_discount": 15,
    "auto_accept": true
  }
}`;

const DISCOVER_EXAMPLE = `POST /m2m/discover
{
  "query": { "category": "eletronicos" }
}`;

const CHECKOUT_EXAMPLE = `POST /m2m/checkout
{
  "session_id": "sess_...",
  "buyer": {
    "name": "Bot Corp",
    "email": "bot@corp.com",
    "cpf": "000.000.000-00"
  },
  "payment_method": "pix"
}`;

export function AgentsTab({ agents, loading, saving, onCreate, onSuspend }: AgentsTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDays, setExpiryDays] = useState(90);

  function resetForm() {
    setName("");
    setUserId("");
    setHasExpiry(false);
    setExpiryDays(90);
  }

  async function handleSubmit() {
    if (!name.trim() || !userId.trim()) return;
    await onCreate({
      displayName: name.trim(),
      globalUserId: userId.trim(),
      expiresInDays: hasExpiry ? expiryDays : undefined,
    });
    resetForm();
    setShowModal(false);
  }

  return (
    <>
      <div className="panel">
        <SectionHeader
          variant="secondary"
          title="Agentes Registrados"
          trailing={
            <button
              type="button"
              className="zyn-btn zyn-btn--primary"
              onClick={() => setShowModal(true)}
              style={{ fontSize: 12, padding: "6px 14px" }}
            >
              + Novo agente
            </button>
          }
        />

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

      {/* API Reference */}
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <SectionHeader variant="secondary" title="Modelo de Requisição" />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <PayloadBlock title="Negociar desconto" code={PAYLOAD_EXAMPLE} />
          <PayloadBlock title="Descobrir produtos" code={DISCOVER_EXAMPLE} />
          <PayloadBlock title="Finalizar checkout" code={CHECKOUT_EXAMPLE} />
        </div>
      </div>

      {/* Create Agent Modal (Side Panel) */}
      <Modal
        isOpen={showModal}
        title="Novo Agente M2M"
        subtitle="Registre um agente comprador para interagir com o checkout via API"
        eyebrow="Checkout Programável"
        onClose={() => { resetForm(); setShowModal(false); }}
        footer={
          <>
            <button type="button" className="zyn-btn" onClick={() => { resetForm(); setShowModal(false); }} style={{ padding: "8px 18px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--color-text-muted)", cursor: "pointer" }}>
              Cancelar
            </button>
            <button type="button" className="zyn-btn zyn-btn--primary" onClick={handleSubmit} disabled={saving || !name.trim() || !userId.trim()} style={{ padding: "8px 18px" }}>
              {saving ? "Criando..." : "Criar agente"}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Nome do agente
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bot Procurement Corp"
              style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-sans)" }}
            />
            <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Identificação visual do agente no painel</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Global User ID
            </label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="agent-procurement-001"
              style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-mono)" }}
            />
            <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Identificador único do agente na plataforma</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>Prazo de expiração</span>
                <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 2 }}>Credenciais expiram após o prazo definido</div>
              </div>
              <ToggleSwitch checked={hasExpiry} onChange={setHasExpiry} />
            </div>
            {hasExpiry && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                  style={{ width: 80, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-mono)" }}
                />
                <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>dias</span>
              </div>
            )}
          </div>

          <div style={{ padding: "14px 16px", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
            <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>
              Após criar, o agente recebe
            </div>
            <ul style={{ margin: 0, padding: "0 0 0 16px", font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.8 }}>
              <li>Secret HMAC para autenticação</li>
              <li>Acesso aos endpoints /m2m/*</li>
              <li>Scopes: read, negotiate, checkout</li>
            </ul>
          </div>
        </div>
      </Modal>
    </>
  );
}

function PayloadBlock({ title, code }: { title: string; code: string }) {
  return (
    <div style={{ background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--color-border)", font: "600 11px var(--font-mono)", color: "var(--color-brand)", letterSpacing: "0.02em" }}>
        {title}
      </div>
      <pre style={{ margin: 0, padding: "12px 14px", font: "12px/1.6 var(--font-mono)", color: "var(--color-text-muted)", overflowX: "auto", whiteSpace: "pre" }}>
        {code}
      </pre>
    </div>
  );
}
