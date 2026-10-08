import { useCallback, useEffect, useRef } from "react";
import { useSupportRefresh } from "./useSupportRefresh.js";
import { supportRefreshCoordinator } from "./support-refresh.js";

type DashboardApi = ReturnType<typeof import("../../../api-client.js").createDashboardApi>;
export function useSupportChat(api: DashboardApi, ticketId: string) {
  const load = useCallback(() => api.getSupportCase(ticketId), [api, ticketId]);
  const { data: detail, loading, error, retryAt, reload } = useSupportRefresh(api, `case:${ticketId}`, load, 15000);
  const lastRead = useRef<string>();
  const currentTicket = useRef(ticketId); currentTicket.current = ticketId;
  useEffect(() => { lastRead.current = undefined; }, [ticketId]);
  const markVisibleRead = useCallback(async (lastMessageId: string) => {
    if (document.hidden || lastRead.current === lastMessageId) return;
    const result = await supportRefreshCoordinator(api).run(`read:${ticketId}:${lastMessageId}`, () => api.markSupportCaseRead(ticketId, lastMessageId));
    if (result.kind === "success" && currentTicket.current === ticketId) lastRead.current = lastMessageId;
  }, [api, ticketId]);
  return { detail, messages: detail?.messages ?? [], loading, error, retryAt, reload, markVisibleRead };
}
