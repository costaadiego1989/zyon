import { useCallback, useEffect, useState } from "react";
import { readError } from "../utils/read-error.js";
import { useApi } from "../hooks/useApi.js";
import type { MerchantProfile } from "../api-client.js";

export type MemberRole = "OWNER" | "ADMIN" | "STAFF";

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole;
  status: "PENDING" | "ACCEPTED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("STAFF");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    if (!merchantId || !inviteEmail.trim() || !inviteName.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      await api.inviteTeamMember(merchantId, {
        name: inviteName.trim(),
        email: inviteEmail.trim(),
        phone: invitePhone.trim() || undefined,
        role: inviteRole,
      });
      setMessage({ text: `Convite enviado para ${inviteEmail}`, kind: "ok" });
      setInviteName("");
      setInviteEmail("");
      setInvitePhone("");
      void load();
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setInviting(false);
    }
  }, [api, merchantId, inviteEmail, inviteRole, load]);

  const updateRole = useCallback(async (userId: string, role: MemberRole) => {
    if (!merchantId) return;
    setMessage(null);
    try {
      await api.updateTeamMemberRole(merchantId, userId, role);
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role } : m));
      setMessage({ text: "Função atualizada.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    }
  }, [api, merchantId]);

  const removeMember = useCallback(async (userId: string) => {
    if (!merchantId) return;
    setRemovingId(userId);
    setMessage(null);
    try {
      await api.removeTeamMember(merchantId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      setMessage({ text: "Membro removido.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
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
