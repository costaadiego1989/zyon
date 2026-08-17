import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { readError } from "../utils/read-error.js";
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("STAFF");
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const merchantId = props.me?.id;

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${(api as any).baseUrl ?? ""}/merchants/${merchantId}/team`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMembers(data.members ?? []);
      setInvites(data.invites ?? []);
    } catch (e) {
      setError(readError(e));
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (props.me) void load();
  }, [props.me]); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = useCallback(async () => {
    if (!merchantId || !inviteEmail.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      const res = await fetch(`${(api as any).baseUrl ?? ""}/merchants/${merchantId}/team/invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body.slice(0, 100));
      }
      setMessage({ text: `Convite enviado para ${inviteEmail}`, kind: "ok" });
      setInviteEmail("");
      void load();
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setInviting(false);
    }
  }, [merchantId, inviteEmail, inviteRole, load]);

  const updateRole = useCallback(async (userId: string, role: MemberRole) => {
    if (!merchantId) return;
    setMessage(null);
    try {
      const res = await fetch(`${(api as any).baseUrl ?? ""}/merchants/${merchantId}/team/${userId}/role`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, role } : m));
      setMessage({ text: "Função atualizada.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    }
  }, [merchantId]);

  const removeMember = useCallback(async (userId: string) => {
    if (!merchantId) return;
    setRemovingId(userId);
    setMessage(null);
    try {
      const res = await fetch(`${(api as any).baseUrl ?? ""}/merchants/${merchantId}/team/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      setMessage({ text: "Membro removido.", kind: "ok" });
    } catch (e) {
      setMessage({ text: readError(e), kind: "error" });
    } finally {
      setRemovingId(null);
    }
  }, [merchantId]);

  return {
    members,
    invites,
    loading,
    error,
    message,
    inviteEmail,
    inviteRole,
    inviting,
    removingId,
    setInviteEmail,
    setInviteRole,
    setMessage,
    load,
    invite,
    updateRole,
    removeMember,
  };
}
