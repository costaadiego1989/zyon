import { io, type Socket } from "socket.io-client";
import type { CreatePlatformSupportTicket, PlatformSupportCapabilities, PlatformSupportConversation, PlatformSupportMessage, PlatformSupportNote, PlatformSupportPage, PlatformSupportQuery, PlatformSupportSeverity, PlatformSupportStatus, SendPlatformSupportMessage } from "@zyon/shared-types";

export type SupportConnectionState = "connecting" | "connected" | "offline";
export interface SupportClientOptions {
  baseUrl: string;
  kind: "merchant" | "operator";
  token?: string;
  request<T>(path: string, init?: { method?: string; body?: string }): Promise<T>;
}

export class SupportClientError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function createPlatformSupportClient(options: SupportClientOptions) {
  let socket: Socket | null = null;
  let authenticated = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<{ changed(): void; state(value: SupportConnectionState): void }>();
  const modes = new Map<string, string>();
  let liveAllowed = options.kind === "operator";
  const prefix = options.kind === "merchant" ? "/merchants/me/platform-support" : "/platform/support";
  const request = <T>(path: string, method = "GET", body?: unknown) => options.request<T>(prefix + path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const state = (value: SupportConnectionState) => { for (const listener of listeners) listener.state(value); };
  const changed = () => { for (const listener of listeners) listener.changed(); };

  return {
    kind: options.kind,
    async capabilities() {
      const access = await request<PlatformSupportCapabilities>("/capabilities");
      liveAllowed = access.realtimeLimit !== 0;
      if (!liveAllowed && socket) { clearTimeout(reconnectTimer); socket.disconnect(); socket = null; authenticated = false; }
      if (listeners.size && liveAllowed) connect();
      return access;
    },
    list(query: PlatformSupportQuery = {}) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") search.set(key, String(value));
      return request<PlatformSupportPage>(search.size ? `?${search}` : "");
    },
    async conversation(id: string, before?: number) {
      const detail = await request<PlatformSupportConversation>(`/${encodeURIComponent(id)}${before ? `?before=${before}` : ""}`);
      modes.set(id, detail.ticket.mode);
      return detail;
    },
    async create(input: CreatePlatformSupportTicket) {
      const detail = await request<PlatformSupportConversation>("", "POST", input);
      modes.set(detail.ticket.id, detail.ticket.mode);
      return detail;
    },
    read: (id: string, sequence: number) => request<{ success: true }>(`/${encodeURIComponent(id)}/read`, "POST", { sequence }),
    reopen: (id: string) => request<PlatformSupportConversation>(`/${encodeURIComponent(id)}/reopen`, "POST", {}),
    treat: (id: string, input: { status?: PlatformSupportStatus; severity?: PlatformSupportSeverity; assignedOperatorId?: string | null }) => request<PlatformSupportConversation>(`/${encodeURIComponent(id)}`, "PATCH", input),
    notes: (id: string) => request<PlatformSupportNote[]>(`/${encodeURIComponent(id)}/notes`),
    addNote: (id: string, content: string, clientRequestId: string) => request<PlatformSupportNote[]>(`/${encodeURIComponent(id)}/notes`, "POST", { content, clientRequestId }),
    async send(id: string, input: SendPlatformSupportMessage): Promise<PlatformSupportMessage> {
      if (socket?.connected && authenticated && (options.kind === "operator" || modes.get(id) === "realtime")) {
        const result = await new Promise<{ success: boolean; message?: PlatformSupportMessage; code?: string } | null>(resolve => {
          socket!.timeout(5000).emit("send_message", { ticketId: id, ...input }, (error: Error | null, reply: { success: boolean; message?: PlatformSupportMessage; code?: string }) => resolve(error ? null : reply));
        });
        if (result?.success && result.message) return result.message;
        if (result && result.code !== "unauthorized") throw new SupportClientError(result.code ?? "support_send_failed");
      }
      // A lost acknowledgement may follow a successful commit. Reuse the same
      // clientMessageId on HTTP so the server returns that persisted message.
      return request<PlatformSupportMessage>(`/${encodeURIComponent(id)}/messages`, "POST", input);
    },
    subscribe(listener: { changed(): void; state(value: SupportConnectionState): void }) {
      listeners.add(listener);
      connect();
      listener.state(authenticated ? "connected" : liveAllowed ? "connecting" : "offline");
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { clearTimeout(reconnectTimer); socket?.disconnect(); socket = null; authenticated = false; }
      };
    },
  };

  function connect() {
      if (!socket && liveAllowed && listeners.size) {
        const base = options.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
        socket = io(`${base}/platform-support`, { transports: ["websocket"], withCredentials: options.kind === "merchant", auth: { kind: options.kind, ...(options.token ? { accessToken: options.token } : {}) }, autoConnect: false });
        socket.on("authenticated", () => { authenticated = true; state("connected"); changed(); });
        socket.on("support_changed", changed);
        socket.on("connect_error", () => { authenticated = false; state("offline"); });
        socket.on("disconnect", (reason: string) => {
          authenticated = false; state("offline");
          if (reason === "io server disconnect") reconnectTimer = setTimeout(() => { if (listeners.size && liveAllowed) socket?.connect(); }, 3000);
        });
        socket.io.on("reconnect_attempt", () => state("connecting"));
        socket.connect();
      }
  }
}

export type PlatformSupportClient = ReturnType<typeof createPlatformSupportClient>;

export function platformSupportError(error: unknown): string {
  const code = error instanceof SupportClientError ? error.code : error && typeof error === "object" ? String((error as { responseBody?: string }).responseBody ?? (error as { code?: string; message?: string }).code ?? (error as { message?: string }).message ?? "") : "";
  if (code.includes("support_realtime_limit_reached")) return "Você usou os 5 atendimentos em tempo real deste mês. Continue pelo chamado ou abra outro chamado sem consumir atendimento em tempo real.";
  if (code.includes("support_realtime_plan_required")) return "O tempo real está incluído no Growth e no Escala. No Básico, abra um chamado para a equipe responder.";
  if (code.includes("support_plan_required")) return "A abertura de chamados está disponível a partir do Básico. Você ainda pode enviar um feedback.";
  if (code.includes("support_rate_limited")) return "Você enviou muitas solicitações. Aguarde um pouco e tente novamente.";
  if (code.includes("support_ticket_resolved")) return "Este chamado foi resolvido. Reabra para continuar a conversa.";
  if (code.includes("support_already_assigned")) return "Outro operador está atendendo este chamado. Atualize a fila ou solicite uma transferência.";
  if (code.includes("support_assignment_forbidden")) return "A transferência para outro operador exige um administrador.";
  if (code.includes("support_ticket_not_found")) return "Chamado não encontrado ou sem permissão de acesso.";
  if (code.includes("support_invalid_")) return "Revise os campos e tente novamente.";
  return "Não foi possível atualizar o atendimento. Seu texto permanece aqui para tentar novamente.";
}
