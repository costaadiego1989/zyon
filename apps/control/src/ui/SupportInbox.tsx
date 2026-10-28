import { useEffect, useMemo, useState } from "react";
import { PlatformSupportDesk } from "@zyon/platform-support-ui";
import { PlatformApi, PlatformApiError, type PlatformOperator } from "../lib/api.js";

export function SupportInbox({ api, token, operator, onSessionExpired }: { api: PlatformApi; token: string; operator: PlatformOperator; onSessionExpired(): void }) {
  const client = useMemo(() => api.supportClient(token), [api, token]);
  const [operators, setOperators] = useState<Array<{ id: string; label: string }>>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  useEffect(() => {
    if (operator.role !== "platform_admin") return;
    let active = true;
    void (async () => {
      const entries: Array<{ id: string; label: string }> = [];
      let cursor: string | undefined;
      do {
        const page = await api.listOperators(token, { status: "active", limit: 100, ...(cursor ? { cursor } : {}) });
        entries.push(...page.items.filter(item => item.role === "platform_admin" || item.role === "support_ops").map(item => ({ id: item.operator_id, label: item.email })));
        cursor = page.next_cursor ?? undefined;
      } while (cursor && active);
      if (active) { setOperators(entries); setDirectoryError(null); }
    })().catch(error => {
      if (!active) return;
      if (error instanceof PlatformApiError && error.status === 401) onSessionExpired();
      else setDirectoryError("Não foi possível carregar a equipe para transferências. Você ainda pode assumir um chamado.");
    });
    return () => { active = false; };
  }, [api, token, operator.role, onSessionExpired]);
  return <div className="page-flow">{directoryError && <p className="form-error" role="status">{directoryError}</p>}<PlatformSupportDesk client={client} operatorId={operator.operator_id} operators={operators} onUnauthorized={onSessionExpired} /></div>;
}
