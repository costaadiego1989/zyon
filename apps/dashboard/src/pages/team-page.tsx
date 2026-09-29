import React, { useEffect, useMemo, useState } from "react";
import { Users, UserPlus, Trash2, Mail, Crown } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { PageHeader } from "../components/PageHeader.js";
import { Button } from "../components/Button.js";
import { StatCard } from "./overview/components/StatCard.js";
import { Modal } from "../components/Modal.js";
import { EmptyState } from "../components/EmptyState.js";
import { DataPanel } from "../components/DataPanel.js";
import { FilterToolbar } from "../components/FilterToolbar.js";
import { FormField, FormSelect } from "../components/FormField.js";
import { useTeamPage, ROLE_LABELS, formatTeamDate, type MemberRole, type TeamMember } from "./useTeamPage.js";
import { maskPhone } from "../utils/masks.js";
import "./administration-pages.css";

export function TeamPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useTeamPage({ me: props.me });
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [removal, setRemoval] = useState<TeamMember | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => vm.members.filter(m => (role === "all" || m.role === role) && m.email.toLowerCase().includes(search.trim().toLowerCase())), [vm.members, role, search]);
  useEffect(() => setPage(1), [search, role]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  const busy = vm.inviting || !!vm.removingId || !!vm.updatingId;
  const closeInvite = () => { if (vm.inviting) return; if (vm.inviteName || vm.inviteEmail || vm.invitePhone) setConfirmDiscard(true); else setShowInviteModal(false); };
  const openInvite = () => { vm.setInviteError(null); setConfirmDiscard(false); setShowInviteModal(true); };
  if (!props.me) return <PageHeader title="Equipe" description="Entre na sua conta para gerenciar a equipe." />;
  return <div className="administration-page">
    <PageHeader title="Equipe" description="Gerencie os membros da equipe e o acesso de cada pessoa à loja." actions={<Button onClick={openInvite} disabled={vm.loading || !!vm.error || busy}><UserPlus size={16} /> Convidar membro</Button>} />
    {vm.message && !removal && <p className={`admin-feedback admin-feedback--${vm.message.kind}`} role={vm.message.kind === "error" ? "alert" : "status"}>{vm.message.text}</p>}
      {/* KPIs */}
      {!vm.loading && vm.members.length > 0 ? (
        <div className="grid-3" style={{ gap: 14, marginBottom: 20 }}>
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
            accent={vm.invites.length > 0 ? "var(--color-warning)" : undefined}
          />
        </div>
      ) : null}


    {vm.loading ? <section className="panel admin-skeleton" aria-label="Carregando equipe" aria-busy="true">{[1,2,3].map(n => <div className="skeleton-cell" key={n} />)}</section> : vm.error ? <section className="panel"><EmptyState icon={Users} title="Equipe indisponível" description="Não foi possível consultar os membros e convites. Tente novamente para ver os acessos atuais." action={<Button variant="outline" onClick={() => void vm.load()}>Tentar novamente</Button>} /></section> : <>
      <FilterToolbar tabs={[{ key: "all", label: "Todos" }, { key: "OWNER", label: "Proprietários" }, { key: "ADMIN", label: "Administradores" }, { key: "STAFF", label: "Agentes" }]} activeTab={role} onTabChange={setRole} search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por e-mail" />
      <DataPanel title="Membros ativos" page={currentPage} pageSize={10} total={filtered.length} onPageChange={setPage} isEmpty={!filtered.length} empty={{ icon: Users, title: vm.members.length ? "Nenhum membro com estes filtros" : "Sua equipe começa aqui", description: vm.members.length ? "Busque outro e-mail ou remova o filtro de função." : "Convide as pessoas que vão atender clientes e administrar sua loja.", action: vm.members.length ? <Button variant="outline" onClick={() => { setSearch(""); setRole("all"); }}>Limpar filtros</Button> : <Button onClick={openInvite}>Convidar membro</Button> }}>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>E-mail</th><th>Função</th><th>Na equipe desde</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>
          {filtered.slice((currentPage - 1) * 10, currentPage * 10).map(m => <tr key={m.id}>
            <td className="admin-email">{m.email}</td><td>{m.role === "OWNER" ? <span className="badge ok">{ROLE_LABELS[m.role]}</span> : <select className="admin-role-select" aria-label={`Função de ${m.email}`} value={m.role} disabled={busy} onChange={e => void vm.updateRole(m.userId, e.target.value as MemberRole)}><option value="ADMIN">Administrador</option><option value="STAFF">Agente</option></select>}</td>
            <td className="admin-muted">{formatTeamDate(m.joinedAt)}</td><td>{m.role !== "OWNER" && <Button className="admin-icon-action" variant="ghost" disabled={busy} aria-label={`Remover ${m.email}`} onClick={() => { vm.setMessage(null); setRemoval(m); }}><Trash2 size={16} /></Button>}</td>
          </tr>)}
        </tbody></table></div>
      </DataPanel>
      <p className="admin-help" style={{ marginTop: 16 }}>As mudanças de função são salvas ao selecionar uma opção. O acesso do proprietário não pode ser alterado nesta lista.</p>
      {vm.invites.length > 0 && <DataPanel title="Convites" trailing={<span className="admin-muted">O acesso começa após o aceite</span>}><div className="table-wrap"><table className="data-table"><thead><tr><th>E-mail</th><th>Função</th><th>Situação</th><th>Expira em</th></tr></thead><tbody>{vm.invites.map(inv => <tr key={inv.id}><td className="admin-email">{inv.email}</td><td>{ROLE_LABELS[inv.role]}</td><td><span className={`badge ${inv.status === "PENDING" ? "warn" : inv.status === "ACCEPTED" ? "ok" : "muted"}`}>{inv.status === "PENDING" ? "Aguardando aceite" : inv.status === "ACCEPTED" ? "Aceito" : "Expirado"}</span></td><td>{formatTeamDate(inv.expiresAt)}</td></tr>)}</tbody></table></div></DataPanel>}
    </>}
    <Modal isOpen={showInviteModal} title="Convidar membro" subtitle="Informe os dados da pessoa e escolha a função que ela terá na loja." presentation="center" size="lg" onClose={closeInvite} footer={<div className="admin-modal-footer">{confirmDiscard ? <><p>Há um convite que ainda não foi enviado.</p><Button variant="outline" onClick={e => { e.preventDefault(); setConfirmDiscard(false); }}>Continuar editando</Button><Button variant="ghost" onClick={() => { vm.setInviteName(""); vm.setInviteEmail(""); vm.setInvitePhone(""); setShowInviteModal(false); setConfirmDiscard(false); }}>Descartar e fechar</Button></> : <><Button variant="ghost" disabled={vm.inviting} onClick={closeInvite}>Cancelar</Button><Button type="submit" form="team-invite" loading={vm.inviting} disabled={!vm.inviteName.trim() || !vm.inviteEmail.trim()}>Enviar convite</Button></>}</div>}>
      <form id="team-invite" className="configuration-form administration-page" onSubmit={async e => { e.preventDefault(); if (await vm.invite()) setShowInviteModal(false); }}>
        <fieldset className="admin-fields" disabled={vm.inviting}>
          <FormField label="Nome completo" value={vm.inviteName} onChange={vm.setInviteName} placeholder="Maria Silva" inputProps={{ required: true, autoComplete: "name" }} />
          <FormField label="E-mail" type="email" value={vm.inviteEmail} onChange={vm.setInviteEmail} placeholder="pessoa@sualoja.com" inputProps={{ required: true, autoComplete: "email" }} />
          <FormField label="WhatsApp (opcional)" type="tel" value={maskPhone(vm.invitePhone)} onChange={v => vm.setInvitePhone(maskPhone(v))} placeholder="(11) 99999-9999" maxLength={15} />
          <FormSelect label="Função" value={vm.inviteRole} onChange={v => vm.setInviteRole(v as MemberRole)} options={[{ value: "STAFF", label: "Agente de suporte" }, { value: "ADMIN", label: "Administrador" }]} hint={vm.inviteRole === "STAFF" ? "Atende conversas e gerencia chamados de suporte." : "Gerencia a operação e as configurações do painel, conforme as permissões da conta."} />
        </fieldset>
        {vm.inviteError && <p role="alert" className="admin-feedback admin-feedback--error">{vm.inviteError}</p>}
      </form>
    </Modal>
    <Modal isOpen={!!removal} title="Remover acesso à loja?" subtitle={removal?.email} presentation="center" size="md" onClose={() => { if (!vm.removingId) setRemoval(null); }} footer={<><Button variant="outline" disabled={!!vm.removingId} onClick={() => setRemoval(null)}>Manter acesso</Button><Button variant="danger" loading={!!vm.removingId} onClick={async () => { if (removal && await vm.removeMember(removal.userId)) setRemoval(null); }}>Remover acesso</Button></>}>
      <div className="administration-page"><p className="admin-help">Esta pessoa deixará de acessar a loja com sua função atual. Para voltar à equipe, ela precisará de um novo convite.</p>{vm.message?.kind === "error" && <p role="alert" className="admin-feedback admin-feedback--error">{vm.message.text}</p>}</div>
    </Modal>
  </div>;
}
