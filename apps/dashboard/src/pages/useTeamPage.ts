import { useCallback, useEffect, useRef, useState } from "react";
import { reportError } from "../hooks/useErrorReporter.js";
import { readError } from "../utils/read-error.js";
import { useApi } from "../hooks/useApi.js";
import { showToast } from "../components/Toast.js";
import type { MerchantProfile } from "../api-client.js";
import type { TeamMember, TeamInvite as PendingInvite, TeamRole as MemberRole } from "../api/endpoints/team-response.js";
export type { TeamMember, TeamInvite as PendingInvite, TeamRole as MemberRole } from "../api/endpoints/team-response.js";

export function formatTeamDate(value: string | null | undefined): string {
  if (!value?.trim()) return "Não informada";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("pt-BR") : "Não informada";
}

export interface TeamPageState {
  members: TeamMember[];
  invites: PendingInvite[];
  loading: boolean;
  error: string | null;
  message: { text: string; kind: "ok" | "error" } | null;
  inviteEmail: string;
  inviteRole: MemberRole;
  inviting: boolean;
  removingId: string | null;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: "Proprietário",
  ADMIN: "Administrador",
  STAFF: "Agente",
};

export { ROLE_LABELS };

export function useTeamPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("STAFF");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const working = useRef(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const merchantId = props.me?.id;

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listTeam(merchantId);
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
    } catch (e) {
      setError(readError(e));
    } finally {
      setLoading(false);
    }
  }, [api, merchantId]);

  useEffect(() => {
    if (props.me) void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = useCallback(async () => {
    if (!merchantId || working.current || !inviteEmail.trim() || !inviteName.trim()) return false;
    working.current = true;
    setInviteError(null);
    setInviting(true);
    setMessage(null);
    try {
      await api.inviteTeamMember(merchantId, {
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        phone: invitePhone.trim() || undefined,
        role: inviteRole,
      });

      showToast("success", `Convite criado para ${inviteEmail}`);
      setInviteName("");
      setInviteEmail("");
      setInvitePhone("");
      setMessage({ text: `Convite criado para ${inviteEmail.trim()}. A pessoa precisa aceitar o convite para acessar a loja.`, kind: "ok" });
      void load();
      return true;
    } catch (e) {
      reportError({ source: "dashboard.team.invite", error: e });
      setInviteError("Não foi possível enviar o convite. Seus dados foram mantidos; confira o e-mail e tente novamente.");
      return false;
    } finally {
      working.current = false;
      setInviting(false);
    }
  }, [api, merchantId, inviteName, inviteEmail, invitePhone, inviteRole, load]);

  const updateRole = useCallback(async (userId: string, role: MemberRole) => {
    if (!merchantId || working.current) return;
    working.current = true;
    setUpdatingId(userId);
    setMessage(null);
    try {
      await api.updateTeamMemberRole(merchantId, userId, role);
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role } : m));
      showToast("success", "Função atualizada");
    } catch (e) {
      reportError({ source: "dashboard.team.role", error: e });
      setMessage({ text: "Não foi possível alterar a função. A função anterior foi mantida; tente novamente.", kind: "error" });
    } finally { working.current = false; setUpdatingId(null); }
  }, [api, merchantId]);

  const removeMember = useCallback(async (userId: string) => {
    if (!merchantId || working.current) return false;
    working.current = true;
    setMessage(null);
    setRemovingId(userId);
    try {
      await api.removeTeamMember(merchantId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      setMessage({ text: "Acesso removido da loja.", kind: "ok" });
      return true;
    } catch (e) {
      reportError({ source: "dashboard.team.remove", error: e });
      setMessage({ text: "Não foi possível remover o acesso. Tente novamente.", kind: "error" });
      return false;
    } finally {
      working.current = false;
      setRemovingId(null);
    }
  }, [api, merchantId]);

  return {
    members,
    invites,
    loading,
    error,
    message,
    inviteName,
    inviteEmail,
    invitePhone,
    inviteRole,
    inviting,
    removingId,
    updatingId,
    inviteError,
    setInviteError,
    setInviteName,
    setInviteEmail,
    setInvitePhone,
    setInviteRole,
    setMessage,
    load,
    invite,
    updateRole,
    removeMember,
  };
}
