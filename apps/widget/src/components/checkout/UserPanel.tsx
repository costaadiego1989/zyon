import React, { useState } from "react";
import {
  X, User, Bot, ShoppingBag, Settings, Package,
  LogOut, Sun, Moon, Loader2, AlertCircle, CheckCircle2, Save, Smartphone, Search, Truck
} from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import type { BuyerAgentPersonality } from "../../hooks/use-buyer-hub.js";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));

const TRACKING_STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando rastreio",
  label_generated: "Etiqueta gerada",
  dispatched: "Despachado",
  in_transit: "Em transporte",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  returned: "Devolvido",
  cancelled: "Cancelado"
};

function trackingStatusLabel(status?: string | null): string | null {
  if (!status) return null;
  return TRACKING_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

export function UserPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.userPanelOpen) return null;

  const hub = vm.buyerHub;
  const displayName = hub.profile?.display_name || vm.activeExperience?.customer?.fullName || "Cliente";
  const email = hub.profile?.email || vm.auth.session?.email || vm.activeExperience?.customer?.email || "";
  const avatarLetter = displayName[0]?.toUpperCase() ?? "C";

  return (
    <>
      <div className="aacp-side-backdrop" onClick={() => vm.setUserPanelOpen(false)} />
      <aside className="aacp-side-panel aacp-user-panel">
        <div className="aacp-side-head">
          <div className="aacp-side-user">
            <div className="aacp-side-avatar">{avatarLetter}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="aacp-side-name">{displayName}</div>
              <div className="aacp-side-email">{email}</div>
            </div>
            <button className="aacp-side-close" onClick={() => vm.setUserPanelOpen(false)} aria-label="Fechar painel">
              <X size={18} />
            </button>
          </div>
        </div>

        <nav className="aacp-side-tabs">
          {[
            { id: "profile", icon: <User size={16} />, label: "Perfil" },
            { id: "agent", icon: <Bot size={16} />, label: "Agente" },
            { id: "orders", icon: <ShoppingBag size={16} />, label: "Pedidos" },
            { id: "settings", icon: <Settings size={16} />, label: "Ajustes" },
          ].map((t) => (
            <button
              key={t.id}
              className={`aacp-side-tab ${vm.userTab === t.id ? "active" : ""}`}
              onClick={() => vm.setUserTab(t.id as any)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="aacp-side-body">
          {hub.loading && !hub.profile ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 8, color: "var(--aacp-muted)", fontSize: 13 }}>
              <Loader2 size={18} className="animate-spin" />
              Carregando...
            </div>
          ) : hub.error && !hub.profile ? (
            <HubError error={hub.error} onRetry={() => void hub.refresh()} />
          ) : (
            <>
              {vm.userTab === "profile" && <ProfileTab vm={vm} />}
              {vm.userTab === "agent" && <AgentTab vm={vm} />}
              {vm.userTab === "orders" && <OrdersTab vm={vm} />}
              {vm.userTab === "settings" && <SettingsTab vm={vm} />}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function HubError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", gap: 12, color: "var(--aacp-muted)", fontSize: 13, textAlign: "center" }}>
      <AlertCircle size={24} style={{ opacity: 0.5, color: "#ef4444" }} />
      <div>{error}</div>
      <button className="aacp-cta" style={{ fontSize: 12, padding: "6px 16px" }} onClick={onRetry}>Tentar novamente</button>
    </div>
  );
}

function ProfileTab({ vm }: { vm: CheckoutAgentViewModel }) {
  const hub = vm.buyerHub;
  const fallbackName = hub.profile?.display_name ?? vm.activeExperience?.customer?.fullName ?? "";
  const fallbackPhone = hub.profile?.phone ?? vm.activeExperience?.customer?.phone ?? "";
  const fallbackEmail = hub.profile?.email ?? vm.auth.session?.email ?? vm.activeExperience?.customer?.email ?? "";
  const [name, setName] = useState(fallbackName);
  const [phone, setPhone] = useState(fallbackPhone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  React.useEffect(() => {
    setName(fallbackName);
    setPhone(fallbackPhone);
  }, [fallbackName, fallbackPhone]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await hub.saveProfile({ display_name: name.trim(), phone: phone.trim() || undefined });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="aacp-side-section">
      <div className="aacp-side-section-title">Dados pessoais</div>

      <div className="aacp-side-field">
        <span>Nome completo</span>
        <div className="aacp-side-input">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome"
            aria-label="Nome completo"
          />
        </div>
      </div>

      <div className="aacp-side-field">
        <span>E-mail</span>
        <div className="aacp-side-input">
          <input value={fallbackEmail} readOnly aria-label="E-mail" style={{ opacity: 0.6 }} />
        </div>
        <span style={{ fontSize: 11, color: "var(--aacp-muted)", marginTop: 2 }}>E-mail não pode ser alterado por aqui.</span>
      </div>

      <div className="aacp-side-field">
        <span>Telefone</span>
        <div className="aacp-side-input">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 11 99999-9999"
            aria-label="Telefone"
          />
        </div>
      </div>

      {saveError ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#ef4444", marginTop: 4 }}>
          <AlertCircle size={13} />
          {saveError}
        </div>
      ) : null}

      {saved ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--aacp-success)", marginTop: 4 }}>
          <CheckCircle2 size={13} />
          Alterações salvas!
        </div>
      ) : null}

      <button
        className="aacp-cta"
        style={{ marginTop: 12 }}
        onClick={() => void handleSave()}
        disabled={saving}
      >
        {saving ? <><Loader2 size={13} className="animate-spin" /> Salvando...</> : <><Save size={13} /> Salvar alterações</>}
      </button>
    </div>
  );
}

function AgentTab({ vm }: { vm: CheckoutAgentViewModel }) {
  const hub = vm.buyerHub;
  const [agentName, setAgentName] = useState(hub.agent?.agent_name ?? "");
  const [personality, setPersonality] = useState<BuyerAgentPersonality>(hub.agent?.personality ?? "balanced");
  const [targetDiscount, setTargetDiscount] = useState(hub.agent?.target_discount_percent ?? 10);
  const [autoAccept, setAutoAccept] = useState(hub.agent?.auto_accept_threshold ?? 5);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const hasAgent = Boolean(hub.agent);

  React.useEffect(() => {
    if (hub.agent) {
      setAgentName(hub.agent.agent_name);
      setPersonality(hub.agent.personality);
      setTargetDiscount(hub.agent.target_discount_percent);
      setAutoAccept(hub.agent.auto_accept_threshold);
    }
  }, [hub.agent]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await hub.saveAgent({
        agent_name: agentName.trim(),
        personality,
        target_discount_percent: targetDiscount,
        auto_accept_threshold: autoAccept
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Falha ao salvar agente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="aacp-side-section">
      <div className="aacp-side-section-title">Seu agente de negociação</div>

      {!hasAgent ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 8px", color: "var(--aacp-muted)", fontSize: 13 }}>
          <Bot size={18} style={{ flexShrink: 0, opacity: 0.6 }} />
          <span>Configure seu agente para negociar automaticamente.</span>
        </div>
      ) : null}

      <div className="aacp-side-field">
        <span>Nome do agente</span>
        <div className="aacp-side-input">
          <input
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Ex: Negociador Pro"
            aria-label="Nome do agente"
          />
        </div>
      </div>

      <div className="aacp-side-field">
        <span>Personalidade</span>
        <select
          value={personality}
          onChange={(e) => setPersonality(e.target.value as BuyerAgentPersonality)}
          className="aacp-side-input"
          style={{ background: "var(--aacp-surface-3)", border: "1px solid var(--aacp-line)", borderRadius: 10, color: "var(--aacp-fg)", padding: "8px 10px", fontSize: 13, width: "100%" }}
          aria-label="Personalidade"
        >
          <option value="conservative">Conservador — aceita descontos menores</option>
          <option value="balanced">Equilibrado — negocia com bom senso</option>
          <option value="aggressive">Agressivo — busca o melhor desconto</option>
        </select>
      </div>

      <div className="aacp-side-field">
        <span>Desconto alvo (%)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="range"
            min={0}
            max={30}
            value={targetDiscount}
            onChange={(e) => setTargetDiscount(Number(e.target.value))}
            style={{ flex: 1 }}
            aria-label="Desconto alvo"
          />
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{targetDiscount}%</span>
        </div>
      </div>

      <div className="aacp-side-field">
        <span>Auto-aceitar acima de (%)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="range"
            min={0}
            max={30}
            value={autoAccept}
            onChange={(e) => setAutoAccept(Number(e.target.value))}
            style={{ flex: 1 }}
            aria-label="Auto-aceitar"
          />
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 32 }}>{autoAccept}%</span>
        </div>
      </div>

      {saveError ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#ef4444", marginTop: 4 }}>
          <AlertCircle size={13} />
          {saveError}
        </div>
      ) : null}

      {saved ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--aacp-success)", marginTop: 4 }}>
          <CheckCircle2 size={13} />
          Agente salvo!
        </div>
      ) : null}

      <button
        className="aacp-cta"
        style={{ marginTop: 12 }}
        onClick={() => void handleSave()}
        disabled={saving}
      >
        {saving
          ? <><Loader2 size={13} className="animate-spin" /> Salvando...</>
          : hasAgent
          ? <><Save size={13} /> Salvar alterações</>
          : <><Bot size={13} /> Criar agente</>
        }
      </button>
    </div>
  );
}

function OrdersTab({ vm }: { vm: CheckoutAgentViewModel }) {
  const hub = vm.buyerHub;
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPurchases = normalizedQuery
    ? hub.purchases.filter((purchase) =>
        [purchase.merchant_name, purchase.order_id, purchase.tracking_code, purchase.tracking_status, purchase.carrier]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery))
      )
    : hub.purchases;

  return (
    <div className="aacp-side-section">
      <div className="aacp-side-section-title">Histórico de pedidos</div>

      {hub.purchases.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--aacp-muted)", fontSize: 13 }}>
          <Package size={28} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
          <div>Nenhum pedido ainda.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="aacp-side-input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Search size={14} style={{ color: "var(--aacp-muted)", flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por loja, pedido ou rastreio"
              aria-label="Buscar pedido ou rastreio"
            />
          </div>

          {filteredPurchases.length === 0 ? (
            <div style={{ textAlign: "center", padding: "20px 0", color: "var(--aacp-muted)", fontSize: 13 }}>
              Nenhum pedido encontrado.
            </div>
          ) : null}

          {filteredPurchases.map((p) => (
            <div
              key={p.id}
              style={{
                background: "var(--aacp-surface-2)",
                border: "1px solid var(--aacp-line)",
                borderRadius: 12,
                padding: "12px 14px"
              }}
            >
              {(() => {
                const statusLabel = trackingStatusLabel(p.tracking_status);
                const timeline = (p.tracking_events ?? []).slice(-3);
                return (
                  <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--aacp-fg)" }}>{p.merchant_name}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--aacp-fg)" }}>
                  {fmtBRL(p.total)}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "var(--aacp-muted)" }}>
                <span>{p.items_count} {p.items_count === 1 ? "item" : "itens"} · {fmtDate(p.created_at)}</span>
                {p.discount_amount > 0 && (
                  <span style={{ color: "var(--aacp-success)", fontWeight: 600 }}>
                    -{fmtBRL(p.discount_amount)}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, color: "var(--aacp-muted)" }}>
                <Truck size={13} style={{ flexShrink: 0 }} />
                {p.tracking_code ? (
                  <>
                    <span>{p.carrier ? p.carrier : "Rastreio"}</span>
                    <strong style={{ color: "var(--aacp-fg)", fontFamily: "monospace", letterSpacing: 0 }}>
                      {p.tracking_code}
                    </strong>
                    {statusLabel ? (
                      <span style={{ color: "var(--aacp-success)", fontWeight: 700 }}>
                        {statusLabel}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span>Aguardando codigo de rastreio</span>
                )}
              </div>
              {timeline.length > 0 ? (
                <div style={{ display: "grid", gap: 6, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--aacp-line)" }}>
                  {timeline.map((event) => (
                    <div key={`${event.status}-${event.occurred_at}-${event.description}`} style={{ display: "grid", gap: 2, fontSize: 11 }}>
                      <strong style={{ color: "var(--aacp-fg)" }}>
                        {trackingStatusLabel(event.status) ?? event.status} - {event.description}
                      </strong>
                      <span style={{ color: "var(--aacp-muted)" }}>
                        {fmtDate(event.occurred_at)}
                        {event.location ? ` - ${event.location}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {p.order_id ? (
                <div style={{ marginTop: 4, fontSize: 10, color: "var(--aacp-muted)" }}>
                  Pedido {p.order_id}
                </div>
              ) : null}
                  </>
                );
              })()}
            </div>
          ))}

          {hub.hasMorePurchases ? (
            <button
              className="aacp-cta"
              style={{ marginTop: 4, fontSize: 12 }}
              onClick={() => void hub.loadMorePurchases()}
              disabled={hub.loading}
            >
              {hub.loading ? <Loader2 size={13} className="animate-spin" /> : null}
              Carregar mais
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SettingsTab({ vm }: { vm: CheckoutAgentViewModel }) {
  return (
    <div className="aacp-side-section">
      <div className="aacp-side-section-title">Preferências</div>

      <div className="aacp-toggle-row">
        <div>
          <strong>Tema {vm.colorMode === "dark" ? "escuro" : "claro"}</strong>
          <p>Alterne entre claro e escuro</p>
        </div>
        <button className="aacp-icon-btn" onClick={vm.toggleColorMode} aria-label="Alternar tema">
          {vm.colorMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <div className="aacp-side-section-title" style={{ marginTop: 20 }}>Autenticação</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: "var(--aacp-muted)", fontSize: 13 }}>
        <Smartphone size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
        <span>Você está autenticado via telefone. Para alterar o número, entre em contato com o suporte.</span>
      </div>

      <button
        className="aacp-side-logout"
        style={{ marginTop: 24 }}
        onClick={() => { vm.auth.logout?.(); vm.setUserPanelOpen(false); }}
      >
        <LogOut size={14} />Sair da conta
      </button>
    </div>
  );
}
