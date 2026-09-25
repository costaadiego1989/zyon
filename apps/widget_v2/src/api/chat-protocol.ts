export interface ChatDisplayReference { turn_id: string; text_hash: string }

export function chatDisplayReference(value: unknown): ChatDisplayReference | undefined {
  const ref = value as ChatDisplayReference | null;
  return ref && typeof ref.turn_id === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(ref.turn_id)
    && typeof ref.text_hash === "string" && /^[a-f0-9]{64}$/.test(ref.text_hash)
    ? { turn_id: ref.turn_id, text_hash: ref.text_hash } : undefined;
}

export interface ChatReceipt {
  message_id: string;
  status: "processing" | "unknown" | "completed" | "reconciled" | "rejected";
}

export interface ChatState {
  protocol: "durable_v2" | "legacy";
  session_id: string;
  conversation_id: string;
  turns: Array<{ id: string; role: "buyer" | "agent"; text: string; occurred_at: string; display_ref?: ChatDisplayReference }>;
  request?: ChatReceipt;
  active_request?: ChatReceipt;
  payment_intent_id?: string;
}

export function chatReceipt(value: unknown): ChatReceipt | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.message_id !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(row.message_id)
    || !["processing", "unknown", "completed", "reconciled", "rejected"].includes(String(row.status))) return undefined;
  return { message_id: row.message_id, status: row.status as ChatReceipt["status"] };
}

export function parseChatState(value: unknown, sessionId: string, conversationId: string): ChatState {
  const row = value as ChatState | null;
  if (!row || row.session_id !== sessionId || row.conversation_id !== conversationId
    || !["durable_v2", "legacy"].includes(row.protocol) || !Array.isArray(row.turns) || row.turns.length > 50
    || row.turns.some(turn => !turn || typeof turn.id !== "string" || !["buyer", "agent"].includes(turn.role)
      || typeof turn.text !== "string" || typeof turn.occurred_at !== "string" || !Number.isFinite(Date.parse(turn.occurred_at)))
    || (row.request !== undefined && !chatReceipt(row.request))
    || (row.payment_intent_id !== undefined && (typeof row.payment_intent_id !== "string"
      || !/^[a-zA-Z0-9_-]{1,200}$/.test(row.payment_intent_id) || !!row.active_request))
    || (row.active_request !== undefined && (!chatReceipt(row.active_request) || !["processing", "unknown"].includes(row.active_request.status)))) {
    throw new Error("checkout_chat_state_invalid");
  }
  return { protocol: row.protocol, session_id: sessionId, conversation_id: conversationId,
    turns: row.turns.map(turn => ({ id: turn.id, role: turn.role, text: turn.text, occurred_at: turn.occurred_at,
      ...(turn.role === "agent" && chatDisplayReference(turn.display_ref) ? { display_ref: chatDisplayReference(turn.display_ref) } : {}) })),
    request: chatReceipt(row.request), active_request: chatReceipt(row.active_request),
    ...(row.payment_intent_id ? { payment_intent_id: row.payment_intent_id } : {}) };
}

/** No cached message text, buyer data, token or commercial response. */
export class PendingChatReference {
  constructor(private readonly key: string) {}
  read(): string | undefined {
    try {
      const value = globalThis.sessionStorage?.getItem(this.key);
      return value && /^[a-zA-Z0-9_-]{16,128}$/.test(value) ? value : undefined;
    } catch { return undefined; }
  }
  write(messageId?: string): void {
    try {
      if (messageId) globalThis.sessionStorage?.setItem(this.key, messageId);
      else globalThis.sessionStorage?.removeItem(this.key);
    } catch { /* The server also exposes unresolved requests after a reload. */ }
  }
}

export class ChatRecoveryRequired extends Error {
  constructor() { super("checkout_chat_recovery_required"); }
}
