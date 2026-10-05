/** Shared by storefront and checkout. Audio activity alone is never a buyer turn. */
export const VOICE_MICROPHONE_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 },
};

export type VoiceInputEvent = {
  type?: string; item_id?: string; audio_start_ms?: number; audio_end_ms?: number; transcript?: string;
};
export type VoiceInputDecision = { kind: "speech" | "noise" | "failed"; itemId: string };

export class RealtimeVoiceInput {
  private readonly starts = new Map<string, number>();
  private readonly durations = new Map<string, number>();
  private readonly handled = new Set<string>();

  receive(event: VoiceInputEvent): VoiceInputDecision | undefined {
    const itemId = event.item_id;
    if (!itemId) return;
    if (event.type === "input_audio_buffer.speech_started" && typeof event.audio_start_ms === "number") {
      this.starts.set(itemId, event.audio_start_ms);
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped" && typeof event.audio_end_ms === "number") {
      const start = this.starts.get(itemId);
      if (start !== undefined) this.durations.set(itemId, event.audio_end_ms - start);
      this.starts.delete(itemId);
      return;
    }
    if (!/conversation\.item\.input_audio_transcription\.(completed|failed)$/.test(event.type ?? "")) return;
    if (this.handled.has(itemId)) return;
    this.handled.add(itemId);
    if (this.handled.size > 64) this.handled.delete(this.handled.values().next().value!);
    const duration = this.durations.get(itemId);
    this.durations.delete(itemId);
    this.starts.delete(itemId);
    if (event.type?.endsWith(".failed")) return { kind: "failed", itemId };
    const text = (event.transcript ?? "").trim();
    if (!/[\p{L}\p{N}]/u.test(text) || (duration !== undefined && duration < 180) || isNoiseTranscript(text)) {
      return { kind: "noise", itemId };
    }
    return { kind: "speech", itemId };
  }
}

function isNoiseTranscript(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[\[\](){}.!?]/g, "").trim();
  return /^(silencio|silence|ruido|noise|barulho|respiracao|breathing|tosse|cough|musica|music|inaudivel|inaudible|incompreensivel|som ambiente|sem fala|no speech|audio vazio)$/.test(normalized);
}

/** Serialises responses so speech and tool completions cannot start overlapping replies. */
export class RealtimeVoiceResponses {
  private active = false;
  private queued = false;
  private playing = false;
  constructor(private readonly send: (event: Record<string, unknown>) => void) {}

  receive(type: string | undefined): void {
    if (type === "response.created") this.active = true;
    if (type === "output_audio_buffer.started") this.playing = true;
    if (type === "output_audio_buffer.stopped" || type === "output_audio_buffer.cleared") this.playing = false;
    if (type !== "response.done" && type !== "response.completed") return;
    this.active = false;
    if (!this.queued) return;
    this.queued = false;
    this.request();
  }

  interrupt(): void {
    if (this.active) this.send({ type: "response.cancel" });
    if (this.playing) this.send({ type: "output_audio_buffer.clear" });
  }

  request(interrupt = false): void {
    if (interrupt) this.interrupt();
    if (this.active) { this.queued = true; return; }
    this.active = true;
    this.send({ type: "response.create" });
  }
}
