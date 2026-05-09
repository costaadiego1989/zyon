import React from "react";
import { X, User, Bot, ShoppingBag, Settings, Pencil, Package, ChevronRight, LogOut, Sun, Moon } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";

export function UserPanel({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.userPanelOpen) return null;

  const user = {
    name: vm.activeExperience?.customer?.fullName || "Cliente",
    email: vm.activeExperience?.customer?.email || "cliente@exemplo.com"
  };

  const fmtBRL = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <>
      <div className="aacp-side-backdrop" onClick={() => vm.setUserPanelOpen(false)} />
      <aside className="aacp-side-panel">
        <div className="aacp-side-head">
          <div className="aacp-side-user">
            <div className="aacp-side-avatar">{user.name[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="aacp-side-name">{user.name}</div>
              <div className="aacp-side-email">{user.email}</div>
            </div>
            <button className="aacp-side-close" onClick={() => vm.setUserPanelOpen(false)}>
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
          {vm.userTab === "profile" && (
            <div className="aacp-side-section">
              <div className="aacp-side-section-title">Dados pessoais</div>
              <div className="aacp-side-field">
                <span>Nome completo</span>
                <div className="aacp-side-input">
                  <input value={user.name} readOnly />
                  <Pencil size={13} />
                </div>
              </div>
              <div className="aacp-side-field">
                <span>E-mail</span>
                <div className="aacp-side-input">
                  <input value={user.email} readOnly />
                  <Pencil size={13} />
                </div>
              </div>
              <button className="aacp-cta" style={{ marginTop: 8 }}>Salvar alterações</button>
            </div>
          )}

          {vm.userTab === "agent" && (
            <div className="aacp-side-section">
              <div className="aacp-side-section-title">Configure seu agente</div>
              <div className="aacp-side-field">
                <span>Nome do agente</span>
                <div className="aacp-side-input"><input defaultValue={vm.activeExperience.agent.name} /></div>
              </div>
              <div className="aacp-toggle-row">
                <div>
                  <strong>Sugerir respostas rápidas</strong>
                  <p>Mostrar chips com respostas sugeridas</p>
                </div>
                <label className="aacp-switch"><input type="checkbox" defaultChecked /><span /></label>
              </div>
              <button className="aacp-cta" style={{ marginTop: 8 }}>Salvar agente</button>
            </div>
          )}

          {vm.userTab === "orders" && (
            <div className="aacp-side-section">
              <div className="aacp-side-section-title">Histórico de pedidos</div>
              {[
                { id: "TS-2814", date: "Hoje", total: 899.8, status: "Em andamento" },
                { id: "TS-2719", date: "12 mai 2026", total: 489, status: "Entregue" },
              ].map((o) => (
                <div key={o.id} className="aacp-order">
                  <div className="aacp-order-icon"><Package size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="aacp-order-id">Pedido #{o.id}</div>
                    <div className="aacp-order-meta">{o.date} · <span className={o.status === "Entregue" ? "ok" : "live"}>{o.status}</span></div>
                  </div>
                  <div className="aacp-order-total">{fmtBRL(o.total)}</div>
                  <ChevronRight size={14} className="aacp-order-arrow" />
                </div>
              ))}
            </div>
          )}

          {vm.userTab === "settings" && (
            <div className="aacp-side-section">
              <div className="aacp-side-section-title">Preferências</div>
              <div className="aacp-toggle-row">
                <div>
                  <strong>Tema {vm.colorMode === "dark" ? "escuro" : "claro"}</strong>
                  <p>Alterne entre claro e escuro</p>
                </div>
                <button className="aacp-icon-btn" onClick={vm.toggleColorMode}>
                  {vm.colorMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                </button>
              </div>
              <button
                className="aacp-side-logout"
                onClick={() => { vm.auth.logout?.(); vm.setUserPanelOpen(false); }}
              >
                <LogOut size={14} />Sair da conta
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
