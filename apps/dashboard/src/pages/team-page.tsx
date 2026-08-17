import React, { useState } from "react";
import { Users, UserPlus, Trash2, Shield, Mail, Crown } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { Button } from "../components/Button.js";
import { StatCard } from "./overview/components/StatCard.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { Modal } from "../components/Modal.js";
import { EmptyState } from "../components/EmptyState.js";
import { FormField, FormSelect } from "../components/FormField.js";
import { useTeamPage, ROLE_LABELS, type MemberRole } from "./useTeamPage.js";

export function TeamPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useTeamPage({ me: props.me, apiBaseUrl: props.apiBaseUrl });
  const [showInviteModal, setShowInviteModal] = useState(false);

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
          <Button variant="primary" size="sm" arrow onClick={() => setShowInviteModal(true)}>
            <UserPlus size={14} /> Novo membro
          </Button>
        </div>
      </header>

      {vm.message ? (
        <p className={`panel ${vm.message.kind === "ok" ? "panel-ok" : "panel-warn"}`}>{vm.message.text}</p>
      ) : null}
      {vm.error ? <p className="panel panel-warn">{vm.error}</p> : null}

      {/* KPIs */}
      {!vm.loading && vm.members.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 20 }}>
          <StatCard
            label="Membros"
            value={vm.members.length}
            icon={<Users size={16} />}
          />
          <StatCard
            label="Administradores"
            value={vm.members.filter((m) => m.role === "OWNER" || m.role === "ADMIN").length}
            icon={<Crown size={16} />}
          />
          <StatCard
            label="Convites pendentes"
            value={vm.invites.length}
            icon={<Mail size={16} />}
            accent={vm.invites.length > 0 ? "var(--warn)" : undefined}
          />
        </div>
      ) : null}

      {/* Members list */}
      <section className="panel stacked">
        <SectionHeader icon={<Shield size={18} />} title="Membros ativos" variant="secondary" />

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
                    <td><code>{m.email}</code></td>
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
          <EmptyState
            icon={Users}
            title="Nenhum membro cadastrado"
            description="Convide agentes e administradores para gerenciar sua loja."
            action={<Button variant="primary" size="sm" arrow onClick={() => setShowInviteModal(true)}><UserPlus size={14} /> Convidar membro</Button>}
          />
        )}
      </section>

      {/* Pending invites */}
      {vm.invites.length > 0 ? (
        <section className="panel stacked" style={{ marginTop: 16 }}>
          <SectionHeader icon={<Mail size={18} />} title="Convites pendentes" variant="secondary" />
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

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        title="Novo membro"
        onClose={() => setShowInviteModal(false)}
        footer={
          <Button
            variant="primary"
            size="sm"
            arrow
            disabled={!vm.inviteEmail.trim() || !vm.inviteName.trim() || vm.inviting}
            onClick={async () => {
              await vm.invite();
              if (!vm.inviting) setShowInviteModal(false);
            }}
          >
            <UserPlus size={14} /> {vm.inviting ? "Enviando..." : "Convidar"}
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <FormField label="Nome completo" placeholder="Maria Silva" value={vm.inviteName} onChange={vm.setInviteName} />
          <FormField label="Email" type="email" placeholder="agente@sualoja.com" value={vm.inviteEmail} onChange={vm.setInviteEmail} />
          <FormField label="WhatsApp" type="tel" placeholder="(11) 99999-9999" value={vm.invitePhone} onChange={vm.setInvitePhone} />
          <FormSelect
            label="Função"
            value={vm.inviteRole}
            onChange={(v) => vm.setInviteRole(v as MemberRole)}
            options={[
              { value: "STAFF", label: "Agente de suporte" },
              { value: "ADMIN", label: "Administrador" },
            ]}
            hint={vm.inviteRole === "STAFF" ? "Agentes podem atender chats e gerenciar tickets." : "Administradores têm acesso completo ao painel."}
          />
        </div>
      </Modal>
    </>
  );
}
