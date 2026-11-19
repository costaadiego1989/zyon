import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationApi, ConversationContext, ConversationDetail, ConversationMessage, ConversationSummary } from "./conversation-types.js";
import { mergeConversationMessages } from "./conversation-reconciliation.js";
import { conversationActions } from "./conversation-actions.js";

interface ConversationSocket {
  connected: boolean;
  joinTicket: (id: string) => void;
  leaveTicket: (id: string) => void;
  onNewMessage: (handler: (raw: unknown) => void) => () => void;
  onCaseUpdated?: (handler: (raw: unknown) => void) => () => void;
  onConnected?: (handler: () => void) => () => void;
}
interface State {
  scope: string; queue: ConversationSummary[]; cursor: string | null; loading: boolean; error: string | null;
  detail: ConversationDetail | null; detailLoading: boolean; detailError: string | null; busy: boolean; actionError: string | null;
}
const blank = (scope: string): State => ({ scope, queue: [], cursor: null, loading: Boolean(scope), error: null,
  detail: null, detailLoading: false, detailError: null, busy: false, actionError: null });
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function socketMessage(raw: unknown, ticketId: string): ConversationMessage | undefined {
  const row = record(raw);
  if (row.ticketId !== ticketId || typeof row.id !== "string" || typeof row.content !== "string" || typeof row.createdAt !== "string"
    || !["buyer", "merchant", "system"].includes(String(row.senderType))) return;
  const metadata = record(row.metadata), delivery = record(metadata.delivery);
  const value: ConversationMessage = { id: row.id, ticketId, content: row.content, createdAt: row.createdAt, senderType: row.senderType as ConversationMessage["senderType"] };
  if (["whatsapp_outgoing", "whatsapp_resume"].includes(String(metadata.kind))) {
    if (metadata.schemaVersion !== 1 || !["queued", "accepted", "delivered", "read", "failed", "unknown"].includes(String(delivery.status))
      || !Number.isSafeInteger(delivery.revision) || Number(delivery.revision) < 0) throw Error("conversation_projection_changed");
    value.delivery = { status: delivery.status as NonNullable<ConversationMessage["delivery"]>["status"], revision: Number(delivery.revision) };
  }
  if (metadata.kind === "whatsapp_outgoing" && typeof metadata.clientMessageId === "string") value.clientMessageId = metadata.clientMessageId;
  if (["text", "button", "voice", "media"].includes(String(metadata.origin))) value.origin = metadata.origin as ConversationMessage["origin"];
  return value;
}

/** Canonical HTTP reads/commands and the existing authenticated support socket.
 * Reconnect reads only; neither a receipt nor an unknown response resends. */
export function useWhatsAppConversations({ context, api, socket }: { context: ConversationContext | null; api: ConversationApi; socket: ConversationSocket }) {
  const scope = context ? JSON.stringify([context.merchant_id, context.user_id]) : "";
  const epoch = useRef({ scope, generation: 0 });
  if (epoch.current.scope !== scope) epoch.current = { scope, generation: epoch.current.generation + 1 };
  const [state, setState] = useState<State>(() => blank(scope));
  const selected = useRef<string | null>(null), selection = useRef(0), listRequest = useRef(0), working = useRef(false);
  const pending = useRef(new Map<string, string>());
  const stream = useRef<{ ticketId: string | null; rows: ConversationMessage[] }>({ ticketId: null, rows: [] });
  const stamp = () => ({ ...epoch.current });
  const live = (token: ReturnType<typeof stamp>) => token.scope === epoch.current.scope && token.generation === epoch.current.generation;
  function mergeCurrentMessages(incoming: readonly ConversationMessage[], ticketId: string) {
    const messages = mergeConversationMessages(stream.current.ticketId === ticketId ? stream.current.rows : [], incoming, ticketId);
    stream.current = { ticketId, rows: messages };
    for (const message of messages) {
      if (!message.clientMessageId || !["accepted", "delivered", "read", "failed"].includes(message.delivery?.status ?? "")) continue;
      const key = JSON.stringify([scope, ticketId, message.content]);
      if (pending.current.get(key) === message.clientMessageId) pending.current.delete(key);
    }
    return messages;
  }

  const reload = useCallback(async (cursor?: string) => {
    if (!scope) return;
    const token = stamp(), request = ++listRequest.current;
    setState(old => ({ ...old, loading: true, error: null }));
    try {
      const page = await api.getWhatsAppConversations({ limit: 50, ...(cursor ? { cursor } : {}) });
      if (!live(token) || request !== listRequest.current) return;
      setState(old => {
        const rows = cursor ? new Map([...old.queue, ...page.data].map(row => [row.id, row])) : new Map(page.data.map(row => [row.id, row]));
        return { ...old, scope, queue: [...rows.values()], cursor: page.next_cursor, loading: false, error: null };
      });
    } catch {
      if (live(token) && request === listRequest.current) setState(old => ({ ...old, loading: false, error: "Não foi possível carregar as conversas." }));
    }
  }, [api, scope]);

  const open = useCallback(async (ticketId: string) => {
    if (!scope) return;
    const token = stamp(), request = ++selection.current;
    if (selected.current !== ticketId) stream.current = { ticketId, rows: [] };
    selected.current = ticketId;
    setState(old => ({ ...old, detail: old.detail?.ticket.id === ticketId ? old.detail : null, detailLoading: true, detailError: null, actionError: null }));
    try {
      const detail = await api.getWhatsAppConversation(ticketId, { limit: 100 });
      if (!live(token) || request !== selection.current) return;
      if (detail.ticket.id !== ticketId) throw Error("conversation_scope_mismatch");
      let messages: ConversationMessage[];
      try { messages = mergeCurrentMessages(detail.messages, ticketId); }
      catch { setState(old => ({ ...old, detailLoading: false, detailError: "O histórico mudou. Recarregue a conversa." })); return; }
      setState(old => {
        if (!live(token) || request !== selection.current) return old;
        return { ...old, scope, detail: { ...detail, messages: stream.current.ticketId === ticketId ? stream.current.rows : messages }, detailLoading: false, detailError: null };
      });
    } catch {
      if (live(token) && request === selection.current) setState(old => ({ ...old, detailLoading: false, detailError: "Não foi possível carregar esta conversa." }));
    }
  }, [api, scope]);

  const refresh = useMemo(() => {
    let queued: { token: ReturnType<typeof stamp>; detail: boolean } | undefined;
    let active: Promise<void> | undefined;
    return (token: ReturnType<typeof stamp>, detail: boolean): Promise<void> => {
      queued = { token, detail: detail || Boolean(queued?.detail && live(queued.token)) };
      if (!active) active = Promise.resolve().then(async () => {
        try {
          while (queued) {
            const job = queued; queued = undefined;
            if (!live(job.token)) continue;
            const ticketId = job.detail ? selected.current : null;
            await Promise.all([reload(), ...(ticketId ? [open(ticketId)] : [])]);
          }
        } finally { queued = undefined; active = undefined; }
      });
      return active;
    };
  }, [reload, open]);

  useEffect(() => {
    selected.current = null; selection.current++; listRequest.current++; working.current = false; pending.current.clear();
    stream.current = { ticketId: null, rows: [] }; setState(blank(scope)); if (scope) void reload();
    return () => { epoch.current.generation++; };
  }, [scope, reload]);
  useEffect(() => {
    const ticketId = state.scope === scope ? state.detail?.ticket.id : undefined;
    if (!ticketId) return;
    socket.joinTicket(ticketId); return () => socket.leaveTicket(ticketId);
  }, [scope, state.scope, state.detail?.ticket.id, socket.joinTicket, socket.leaveTicket]);
  useEffect(() => {
    const token = stamp();
    return socket.onNewMessage(raw => {
      if (!live(token) || !selected.current) return;
      const ticketId = selected.current;
      try {
        const value = socketMessage(raw, ticketId); if (!value) return;
        const messages = mergeCurrentMessages([value], ticketId);
        setState(old => {
          if (old.scope !== scope || old.detail?.ticket.id !== ticketId) return old;
          return { ...old, detail: { ...old.detail, messages: stream.current.ticketId === ticketId ? stream.current.rows : messages } };
        });
      } catch { setState(old => ({ ...old, detailError: "O histórico mudou. Recarregue a conversa." })); }
    });
  }, [scope, socket.connected, socket.onNewMessage]);
  useEffect(() => {
    const token = stamp();
    return socket.onCaseUpdated?.(raw => {
      const event = record(raw); if (!live(token) || typeof event.ticketId !== "string") return;
      void refresh(token, selected.current === event.ticketId);
    });
  }, [scope, socket.connected, socket.onCaseUpdated, refresh]);
  useEffect(() => {
    const token = stamp();
    return socket.onConnected?.(() => { if (live(token) && scope) void refresh(token, true); });
  }, [scope, socket.connected, socket.onConnected, refresh]);
  const wasConnected = useRef(socket.connected);
  useEffect(() => {
    const restored = socket.connected && !wasConnected.current; wasConnected.current = socket.connected;
    if (restored && scope && !socket.onConnected) void refresh(stamp(), true);
  }, [socket.connected, socket.onConnected, scope, refresh]);

  const current = state.scope === scope ? state : blank(scope);
  async function loadMoreMessages() {
    const ticketId = current.detail?.ticket.id, cursor = current.detail?.next_cursor;
    if (!ticketId || !cursor) return;
    const token = stamp(), request = selection.current;
    try {
      const page = await api.getWhatsAppConversation(ticketId, { limit: 100, cursor });
      if (!live(token) || selected.current !== ticketId || request !== selection.current) return;
      if (page.ticket.id !== ticketId) throw Error("conversation_scope_mismatch");
      let messages: ConversationMessage[];
      try { messages = mergeCurrentMessages(page.messages, ticketId); }
      catch { setState(old => ({ ...old, detailError: "O histórico mudou. Recarregue a conversa." })); return; }
      setState(old => {
        if (old.detail?.ticket.id !== ticketId) return old;
        return { ...old, detail: { ...old.detail, messages: stream.current.ticketId === ticketId ? stream.current.rows : messages, has_more: page.has_more, next_cursor: page.next_cursor } };
      });
    } catch {
      if (live(token) && selected.current === ticketId && request === selection.current) setState(old => ({ ...old, detailError: "Não foi possível carregar mais mensagens. O histórico atual foi preservado." }));
    }
  }
  async function command(kind: "claim" | "close" | "send", content?: string) {
    if (working.current || !context || !current.detail?.binding || current.detailLoading || current.detailError) throw Error("conversation_command_unavailable");
    if (!conversationActions(context, current.detail, socket.connected)[kind]) throw Error("conversation_command_unavailable");
    const token = stamp(), ticketId = current.detail.ticket.id, expectedEpoch = current.detail.binding.epoch;
    working.current = true; setState(old => ({ ...old, busy: true, actionError: null }));
    let submitted: ConversationMessage | undefined;
    try {
      if (kind === "claim") await api.claimWhatsAppConversation(ticketId, { expectedEpoch });
      else if (kind === "close") await api.closeWhatsAppConversation(ticketId, { expectedEpoch });
      else {
        const text = content?.trim(); if (!text || text.length > 4000) throw Error("invalid_whatsapp_message");
        const key = JSON.stringify([scope, ticketId, text]), clientMessageId = pending.current.get(key) ?? crypto.randomUUID();
        pending.current.set(key, clientMessageId);
        const message = await api.sendWhatsAppConversationMessage(ticketId, { content: text, clientMessageId });
        if (message.ticketId !== ticketId || message.clientMessageId !== clientMessageId) throw Error("conversation_scope_mismatch");
        submitted = message;
        if (live(token) && selected.current === ticketId) {
          const messages = mergeCurrentMessages([message], ticketId);
          setState(old => old.detail?.ticket.id === ticketId ? { ...old, detail: { ...old.detail, messages: stream.current.ticketId === ticketId ? stream.current.rows : messages } } : old);
        }
      }
      if (live(token)) await refresh(token, selected.current === ticketId);
      if (submitted && live(token) && selected.current === ticketId) {
        const clientMessageId = submitted.clientMessageId;
        return stream.current.rows.find(row => row.ticketId === ticketId && row.clientMessageId === clientMessageId);
      }
    } catch (error) {
      if (live(token)) {
        await refresh(token, selected.current === ticketId);
        if (selected.current === ticketId) setState(old => ({ ...old, actionError: "Não foi possível confirmar a ação. O histórico e seu rascunho foram preservados." }));
      }
      throw error;
    } finally { if (live(token)) { working.current = false; setState(old => ({ ...old, busy: false })); } }
  }
  return { ...current, connected: socket.connected, reload, open, loadMore: () => current.cursor ? reload(current.cursor) : Promise.resolve(), loadMoreMessages,
    closeDrawer: () => { selected.current = null; selection.current++; stream.current = { ticketId: null, rows: [] }; setState(old => ({ ...old, detail: null, detailLoading: false, detailError: null, actionError: null })); },
    claim: () => command("claim"), closeCase: () => command("close"), send: (content: string) => command("send", content) };
}
