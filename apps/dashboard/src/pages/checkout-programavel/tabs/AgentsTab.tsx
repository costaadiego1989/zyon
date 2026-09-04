import React, { useState } from "react";
import { Bot, Clock } from "lucide-react";
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

function daysUntil(iso: string | null): string {
  if (!iso) return "Sem expiração";
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (diff <= 0) return "Expirado";
  return `${diff} dias restantes`;
}

function agentStatus(agent: M2MAgentResponse): "active" | "suspended" | "expired" {
  if (agent.expiresAt && new Date(agent.expiresAt).getTime() < Date.now()) return "expired";
  return agent.status as "active" | "suspended";
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  active: { bg: "var(--color-success-bg)", color: "var(--color-success)", label: "Ativo" },
  suspended: { bg: "var(--color-error-bg)", color: "var(--color-error)", label: "Suspenso" },
  expired: { bg: "var(--color-warning-bg)", color: "var(--color-warning)", label: "Expirado" },
};

// ── Payload Reference ────────────────────────────────────────────────────────

const FLOW_STEPS = [
  {
    step: "★",
    title: "Comprar (single-call)",
    endpoint: "POST /m2m/checkout",
    note: "Única chamada necessária. Retorna link de pagamento (PIX QR code ou Card clientSecret). Padrão Stripe Checkout Sessions.",
    required: true,
    code: `{
  "cart": {
    "items": [{ "sku": "SKU-001", "name": "Tênis", "price": 199.90, "quantity": 1 }],
    "total": 199.90
  },
  "payment_method": "pix",
  "buyer_info": {
    "name": "Corp Bot",
    "email": "bot@corp.com",
    "cpf": "12345678909",
    "phone": "11999887766",
    "address": {
      "cep": "01310100",
      "street": "Av Paulista",
      "number": "1000",
      "city": "São Paulo",
      "state": "SP"
    }
  },
  "selected_shipping": { "carrier": "PAC", "priceInCents": 1590 }
}`,
    response: `{ sessionId, payment: { method: "pix", qrCode, qrCodeImage, expiresAt } }`,
  },
  {
    step: "①",
    title: "Descobrir produtos (opcional)",
    endpoint: "POST /m2m/discover",
    code: `{ "query": { "category": "eletronicos" } }`,
    response: `items: [{ sku, name, price, imageUrl }]`,
  },
  {
    step: "②",
    title: "Negociar desconto (opcional)",
    endpoint: "POST /m2m/negotiate",
    code: `{
  "cart": {
    "items": [{ "sku": "SKU-001", "price": 199.90, "quantity": 1 }],
    "total": 199.90
  },
  "preferences": { "target_discount": 15, "auto_accept": true }
}`,
    response: `{ agreement: true, selectedDiscountPercent: 10 }`,
  },
  {
    step: "③",
    title: "Calcular frete (opcional)",
    endpoint: "POST /m2m/quote",
    code: `{
  "cart": { "items": [...], "total": 199.90 },
  "shipping_address": { "cep": "01310100" }
}`,
    response: `{ shippingOptions: [{ carrier, price, days }], totalCents }`,
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export function AgentsTab({ agents, loading, saving, onCreate, onSuspend }: AgentsTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiryDays, setExpiryDays] = useState(90);

  function resetForm() { setName(""); setUserId(""); setHasExpiry(false); setExpiryDays(90); }

  async function handleSubmit() {
    if (!name.trim() || !userId.trim()) return;
    await onCreate({ displayName: name.trim(), globalUserId: userId.trim(), expiresInDays: hasExpiry ? expiryDays : undefined });
    resetForm();
    setShowModal(false);
  }

  return (
    <>
      {/* Agents Grid */}
      <div className="panel">
        <SectionHeader
          variant="secondary"
          title="Agentes Registrados"
          trailing={
            <button type="button" className="zyn-btn zyn-btn--primary" onClick={() => setShowModal(true)} style={{ fontSize: 12, padding: "6px 14px" }}>
              + Novo agente
            </button>
          }
        />

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>Carregando...</div>
        ) : agents.length === 0 ? (
          <EmptyState icon={Bot} title="Nenhum agente registrado" description="Crie um agente para permitir checkout programático via API" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
            {agents.map((agent) => {
              const status = agentStatus(agent);
              const st = STATUS_STYLE[status];
              return (
                <div
                  key={agent.id}
                  style={{
                    padding: "16px 18px",
                    background: "var(--surface-1)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {/* Top: name + status */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>{agent.displayName}</span>
                    <span style={{ padding: "3px 10px", borderRadius: "var(--radius-full)", font: "600 10px var(--font-mono)", background: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                  </div>

                  {/* ID */}
                  <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agent.globalUserId}
                  </div>

                  {/* Metrics row */}
                  <div style={{ display: "flex", gap: 16, font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                    <span><strong style={{ color: "var(--color-text)", font: "600 12px var(--font-data)" }}>{agent.reputation?.transactionCount ?? 0}</strong> transações</span>
                    <span><strong style={{ color: "var(--color-brand)", font: "600 12px var(--font-data)" }}>{agent.reputation?.reputationScore ?? 0}%</strong> reputação</span>
                  </div>

                  {/* Expiry + action */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, font: "11px var(--font-sans)", color: status === "expired" ? "var(--color-warning)" : "var(--color-text-faint)" }}>
                      <Clock size={11} /> {daysUntil(agent.expiresAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSuspend(agent.id, status === "active")}
                      style={{ font: "500 11px var(--font-sans)", padding: "4px 10px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--color-text-muted)", cursor: "pointer" }}
                    >
                      {status === "active" ? "Suspender" : "Reativar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payload Reference */}
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <SectionHeader variant="secondary" title="API Reference" />
        <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", margin: "0 0 4px", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--color-text)" }}>Uma chamada = uma compra.</strong> O endpoint <code style={{ font: "12px var(--font-mono)", color: "var(--color-brand)" }}>POST /m2m/checkout</code> recebe
          item + dados do comprador + método de pagamento e retorna o link de pagamento (QR code PIX ou clientSecret para cartão).
          Os endpoints opcionais servem para enriquecer a jornada: buscar catálogo, negociar desconto, calcular frete.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {FLOW_STEPS.map((s) => {
            const isRequired = (s as any).required;
            return (
            <div key={s.step} style={{ background: "var(--surface-1)", border: `1px solid ${isRequired ? "var(--color-brand)" : "var(--color-border)"}`, borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 10, background: isRequired ? "color-mix(in srgb, var(--color-brand) 6%, transparent)" : undefined }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", background: isRequired ? "var(--color-brand)" : "var(--color-text-faint)", color: "#fff", font: "700 11px var(--font-mono)", display: "grid", placeItems: "center", flexShrink: 0 }}>{s.step}</span>
                <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>{s.title}</span>
                <code style={{ marginLeft: "auto", font: "11px var(--font-mono)", color: "var(--color-brand)" }}>{s.endpoint}</code>
              </div>
              {s.note && (
                <div style={{ padding: "6px 14px", background: isRequired ? "color-mix(in srgb, var(--color-brand) 6%, transparent)" : "color-mix(in srgb, var(--color-warning) 8%, transparent)", font: "11px var(--font-sans)", color: isRequired ? "var(--color-brand)" : "var(--color-warning)" }}>
                  {isRequired ? "✓" : "⚠"} {s.note}
                </div>
              )}
              <pre style={{ margin: 0, padding: "12px 14px", font: "11px/1.6 var(--font-mono)", color: "var(--color-text-muted)", overflowX: "auto", whiteSpace: "pre" }}>{s.code}</pre>
              <div style={{ padding: "6px 14px", borderTop: "1px solid var(--color-border)", font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>
                → {s.response}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Create Agent Modal */}
      <Modal
        isOpen={showModal}
        title="Novo Agente M2M"
        subtitle="Registre um agente comprador para interagir com o checkout via API"
        eyebrow="Checkout Programável"
        onClose={() => { resetForm(); setShowModal(false); }}
        footer={
          <>
            <button type="button" onClick={() => { resetForm(); setShowModal(false); }} style={{ padding: "8px 18px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--color-text-muted)", cursor: "pointer", font: "500 13px var(--font-sans)" }}>
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
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Nome do agente</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bot Procurement Corp"
              style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-sans)" }} />
            <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Identificação visual do agente no painel</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>Global User ID</label>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="agent-procurement-001"
              style={{ width: "100%", padding: "10px 14px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-mono)" }} />
            <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Identificador único do agente na plataforma</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>Prazo de expiração</span>
                <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 2 }}>Credenciais expiram após o prazo</div>
              </div>
              <ToggleSwitch checked={hasExpiry} onChange={setHasExpiry} />
            </div>
            {hasExpiry && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="number" min={1} max={365} value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))}
                  style={{ width: 80, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", background: "var(--surface-2)", color: "var(--color-text)", font: "13px var(--font-mono)" }} />
                <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>dias</span>
              </div>
            )}
          </div>

          <div style={{ padding: "14px 16px", background: "var(--surface-1)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
            <div style={{ font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Após criar, o agente recebe</div>
            <ul style={{ margin: 0, padding: "0 0 0 16px", font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.8 }}>
              <li>Secret HMAC para autenticação</li>
              <li>Acesso aos endpoints /m2m/* (discover, negotiate, quote, checkout)</li>
              <li>Campos obrigatórios: SKU, CEP, buyer_info, payment_method</li>
            </ul>
          </div>
        </div>
      </Modal>
    </>
  );
}
