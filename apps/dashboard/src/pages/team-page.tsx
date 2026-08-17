import React from "react";
import { Users, UserPlus, Trash2, RefreshCw, Mail, Shield } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { Button } from "../components/Button.js";
import { useTeamPage, ROLE_LABELS, type MemberRole } from "./useTeamPage.js";

export function TeamPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useTeamPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Equipe</h1>
          <p className="page-lead">Login necessário para gerenciar a equipe.</p>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow"><Users size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }} />Conta</span>
          <h1>Equipe</h1>
          <p className="page-lead">Gerencie os membros e agentes da sua loja.</p>
        </div>
        <div className="button-row" style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button variant="outline" size="sm" disabled={vm.loading} onClick={() => void vm.load()}>
            <RefreshCw size={14} /> Atualizar
          </Button>
        </div>
      </header>

      {vm.message ? (
        <p className={`panel ${vm.message.kind === "ok" ? "panel-ok" : "panel-warn"}`}>{vm.message.text}</p>
      ) : null}
      {vm.error ? <p className="panel panel-warn">{vm.error}</p> : null}

      {/* Invite section */}
      <section className="panel stacked">
        <div className="panel-title">
          <UserPlus size={18} />
          <h2>Convidar membro</h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--color-muted)", margin: "0 0 16px" }}>
          Envie um convite por e-mail. O novo membro receberá uma senha provisória para acessar o painel.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--color-muted)", marginBottom: 4 }}>Email</label>
            <input
              type="email"
              placeholder="agente@sualoija.com"
              value={vm.inviteEmail}
              onChange={(e) => vm.setInviteEmail(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--color-muted)", marginBottom: 4 }}>Função</label>
            <select value={vm.inviteRole} onChange={(e) => vm.setInviteRole(e.target.value as MemberRole)}>
              <option value="STAFF">Agente</option>
              <option value="ADMIN">Administrador</option>
            </select>
          </div>
          <Button variant="primary" size="sm" arrow disabled={!vm.inviteEmail.trim() || vm.inviting} onClick={() => void vm.invite()}>
            <Mail size={14} /> {vm.inviting ? "Enviando..." : "Convidar"}
          </Button>
        </div>
      </section>

      {/* Members list */}
      <section className="panel stacked" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <Shield size={18} />
          <h2>Membros ativos</h2>
        </div>

        {vm.loading ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Email</th><th>Função</th><th>Desde</th><th></th></tr>
              </thead>
              <tbody>
                {Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="skeleton-row">
                    <td><div className="skeleton-cell" style={{ width: 180 }} /></td>
                    <td><div className="skeleton-cell" style={{ width: 80 }} /></td>
                    <td><div className="skeleton-cell" style={{ width: 80 }} /></td>
                    <td><div className="skeleton-cell" style={{ width: 30 }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : vm.members.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Email</th><th>Função</th><th>Desde</th><th></th></tr>
              </thead>
              <tbody>
                {vm.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <code>{m.email}</code>
                    </td>
                    <td>
                      {m.role === "OWNER" ? (
                        <span className="badge ok">{ROLE_LABELS[m.role]}</span>
                      ) : (
                        <select
                          value={m.role}
                          onChange={(e) => void vm.updateRole(m.userId, e.target.value as MemberRole)}
                          style={{ fontSize: 12, padding: "2px 8px" }}
                        >
                          <option value="ADMIN">Administrador</option>
                          <option value="STAFF">Agente</option>
                        </select>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--color-muted)" }}>
                      {new Date(m.joinedAt).toLocaleDateString("pt-BR")}
                    </td>
                    <td>
                      {m.role !== "OWNER" ? (
                        <button
                          type="button"
                          onClick={() => void vm.removeMember(m.userId)}
                          disabled={vm.removingId === m.userId}
                          aria-label={`Remover ${m.email}`}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-danger, #ef4444)", padding: 4, opacity: vm.removingId === m.userId ? 0.5 : 1 }}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: 32, color: "var(--color-muted)", fontSize: 13 }}>
            Nenhum membro cadastrado além do proprietário.
          </div>
        )}
      </section>

      {/* Pending invites */}
      {vm.invites.length > 0 ? (
        <section className="panel stacked" style={{ marginTop: 16 }}>
          <div className="panel-title">
            <Mail size={18} />
            <h2>Convites pendentes</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Email</th><th>Função</th><th>Status</th><th>Expira</th></tr>
              </thead>
              <tbody>
                {vm.invites.map((inv) => (
                  <tr key={inv.id}>
                    <td><code>{inv.email}</code></td>
                    <td><span className="badge muted">{ROLE_LABELS[inv.role]}</span></td>
                    <td>
                      <span className={`badge ${inv.status === "PENDING" ? "warn" : inv.status === "ACCEPTED" ? "ok" : "muted"}`}>
                        {inv.status === "PENDING" ? "Pendente" : inv.status === "ACCEPTED" ? "Aceito" : "Expirado"}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--color-muted)" }}>
                      {new Date(inv.expiresAt).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
