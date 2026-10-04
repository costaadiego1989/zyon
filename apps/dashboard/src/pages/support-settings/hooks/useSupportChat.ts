import { useCallback, useEffect, useRef, useState } from "react";
import type { OperatorSupportCase } from "../../../api/endpoints/support.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;
export function useSupportChat(api: DashboardApi, ticketId: string) {
  const [detail, setDetail] = useState<OperatorSupportCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const lastRead = useRef<string>();
  const reload = useCallback(async () => {
    const current = ++request.current;
    try { const data = await api.getSupportCase(ticketId); if (current === request.current) { setDetail(data); setError(null); } }
    catch (e) { if (current === request.current) setError(e instanceof Error ? e.message : "Não foi possível carregar o histórico da conversa."); }
    finally { if (current === request.current) setLoading(false); }
  }, [api, ticketId]);
  useEffect(() => {
    setDetail(null); setLoading(true); lastRead.current = undefined;
    void reload();
    const refresh = () => { if (!document.hidden) void reload(); };
    const interval = window.setInterval(refresh, 5000); window.addEventListener("focus", refresh);
    return () => { request.current++; window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [reload]);
  const lastMessageId = detail?.messages.at(-1)?.id;
  useEffect(() => {
    if (!lastMessageId || document.hidden || lastRead.current === lastMessageId) return;
    void api.markSupportCaseRead(ticketId, lastMessageId).then(() => { lastRead.current = lastMessageId; }).catch(() => undefined);
  }, [api, ticketId, lastMessageId]);
  return { detail, messages: detail?.messages ?? [], loading, error, reload };
}
