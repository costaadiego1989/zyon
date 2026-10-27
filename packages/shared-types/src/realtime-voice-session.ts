/** Public browser/server voice contract. Provider credentials never cross it. */
export type RealtimeVoiceCall = { sdp: string };

export type RealtimeServerVoiceEvent = {
  type?: string; response_id?: string;
  response?: { id?: string; metadata?: Record<string, string> };
};

/** The API sideband owns response admission, quota and tool continuations. */
export class RealtimeServerVoiceTurns {
  private readonly permits = new Map<string, string>();
  private active = false;
  private playing = false;
  constructor(private readonly send: (event: Record<string, unknown>) => void) {}

  receive(event: RealtimeServerVoiceEvent): void {
    if (event.type === "response.created") {
      this.active = true;
      const permit = event.response?.metadata?.zyon_turn_token;
      if (event.response?.id && typeof permit === "string" && permit.length <= 512) this.permits.set(event.response.id, permit);
    }
    if (event.type === "output_audio_buffer.started") this.playing = true;
    if (event.type === "output_audio_buffer.stopped" || event.type === "output_audio_buffer.cleared") this.playing = false;
    if (event.type === "response.done" || event.type === "response.completed") {
      this.active = false;
      if (event.response?.id) this.permits.delete(event.response.id);
    }
  }

  permitFor(responseId?: string): string | undefined { return responseId ? this.permits.get(responseId) : undefined; }

  interrupt(): void {
    if (this.active) this.send({ type: "response.cancel" });
    if (this.playing) this.send({ type: "output_audio_buffer.clear" });
  }

  sendText(text: string): void {
    this.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
  }
}

export function normalizeRealtimeSdp(value: unknown): string {
  if (typeof value !== "string" || value.length > 200_000 || !value.trim().startsWith("v=0")) {
    throw new Error("voice_sdp_invalid");
  }
  return `${value.trim().replace(/\r\n|\r|\n/g, "\n").replace(/\n/g, "\r\n")}\r\n`;
}

/** Retain only a machine code and HTTP status, never a provider's raw error. */
export async function readRealtimeVoiceCall(response: Response): Promise<RealtimeVoiceCall> {
  const data = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const candidate = data?.code ?? data?.message ?? data?.detail;
    const code = typeof candidate === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(candidate)
      ? candidate : "voice_session_failed";
    const error = new Error(code) as Error & { status: number; code: string };
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return { sdp: normalizeRealtimeSdp(data?.sdp) };
}

export function realtimeVoiceFailureHint(error: unknown, fallback: string): string {
  const value = error as { code?: unknown; message?: unknown } | null;
  const code = typeof value?.code === "string" ? value.code : value?.message;
  switch (code) {
    case "voice_sdp_offer_required":
    case "voice_sdp_invalid":
      return "Não foi possível negociar a conexão de áudio. Atualize a página e tente novamente. Código: " + code;
    case "voice_provider_unavailable":
    case "voice_provider_session_failed":
    case "voice_provider_invalid_response":
    case "voice_session_failed":
      return "O serviço de voz não conseguiu iniciar a conexão. Tente novamente em instantes. Código: " + code;
    case "ai_interaction_rate_limited":
      return "Você atingiu o limite de interações por minuto. Aguarde um minuto e tente novamente.";
    default:
      return fallback;
  }
}
