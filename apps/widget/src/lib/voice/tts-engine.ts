// TTS engine — SpeechSynthesis wrapper with SSML parsing.
//
// Browser SpeechSynthesis is the primary engine (free, no key). When unavailable
// the engine reports its type as "elevenlabs" so the calling layer can swap in
// a server-side fallback. We pick a high-quality pt-BR voice when multiple are
// available (REQ-VC-002: "natural female pt-BR configurable per merchant").
//
// SSML parsing is intentionally tolerant — we strip wrappers, expand <break>
// into a spoken pause marker, and uppercase <emphasis> words. The parsed text is
// always safe to send to SpeechSynthesisUtterance even if it contains stray tags.

export type TTSEngineType = "speech-synthesis" | "elevenlabs";

export type TTSError = {
  code: "synthesis-failed" | "not-allowed" | "unsupported" | "aborted";
  message: string;
};

export type TTSEngineOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  preferredVoice?: string;
  fallback?: "elevenlabs";
  onStart?: () => void;
  onEnd?: () => void;
  onBoundary?: (event: { name?: string; charIndex?: number }) => void;
  onError?: (error: TTSError) => void;
};

type BrowserUtterance = {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onboundary: ((event: { name?: string; charIndex?: number }) => void) | null;
};

type BrowserUtteranceCtor = new (text: string) => BrowserUtterance;

type BrowserSynthesis = {
  cancel: () => void;
  speak: (u: BrowserUtterance) => void;
  getVoices?: () => Array<{ name: string; lang: string; localService?: boolean }>;
};

function resolveSynthesis(): { synthesis: BrowserSynthesis | null; Utterance: BrowserUtteranceCtor | null } {
  if (typeof window === "undefined") return { synthesis: null, Utterance: null };
  const w = window as unknown as { speechSynthesis?: BrowserSynthesis; SpeechSynthesisUtterance?: BrowserUtteranceCtor };
  const synth = w.speechSynthesis ?? null;
  const Utterance = w.SpeechSynthesisUtterance ?? null;
  return { synthesis: synth, Utterance };
}

function scoreVoice(voice: { name: string; lang: string; localService?: boolean }): number {
  const lang = voice.lang?.toLowerCase().replace("_", "-") ?? "";
  if (!lang.startsWith("pt")) return -1;
  let score = lang === "pt-br" ? 100 : lang.startsWith("pt") ? 40 : 0;
  const name = voice.name?.toLowerCase() ?? "";
  if (/natural|neural|premium|enhanced/.test(name)) score += 48;
  if (/google/.test(name)) score += 32;
  if (/online|microsoft/.test(name)) score += 22;
  if (/maria|francisca|luciana|brenda|thalita|giovanna|clara|heloisa/.test(name)) score += 16;
  if (/daniel|antonio|fabio|julio|ricardo/.test(name)) score += 8;
  if (voice.localService && !/natural|neural|premium|enhanced/.test(name)) score -= 8;
  return score;
}

function pickBestVoice(
  voices: Array<{ name: string; lang: string; localService?: boolean }>,
  preferredName?: string,
): { name: string; lang: string; localService?: boolean } | null {
  if (preferredName) {
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  let best: { name: string; lang: string; localService?: boolean } | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = scoreVoice(voice);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return bestScore >= 0 ? best : null;
}

export function parseSSML(input: string): string {
  if (!input) return input;
  let text = input;
  const isWhitespaceOnly = /^\s*$/.test(input);

  // Unwrap <speak>...</speak>.
  text = text.replace(/<\/?speak[^>]*>/gi, "");

  // <break time='500ms'/> → " ... " (a pause marker SpeechSynthesis ignores but
  // humans still see as a paragraph break).
  text = text.replace(/<break[^>]*\/>/gi, " ... ");
  text = text.replace(/<break[^>]*>.*?<\/break>/gi, " ... ");

  // <emphasis>word</emphasis> → uppercase word.
  text = text.replace(/<emphasis[^>]*>([\s\S]*?)<\/emphasis>/gi, (_, inner: string) =>
    inner.trim().toUpperCase(),
  );

  // Drop any remaining tags (defensive — must not throw on malformed SSML).
  text = text.replace(/<[^>]+>/g, "");

  // Preserve whitespace-only inputs (tests rely on it). Otherwise collapse the
  // edge whitespace that comes from stripping wrappers.
  return isWhitespaceOnly ? text : text.trim();
}

export type TTSEngine = {
  speak: (text: string) => void;
  cancel: () => void;
  isAvailable: () => boolean;
  getEngineType: () => TTSEngineType;
  getActiveVoiceName: () => string | null;
};

export function createTTSEngine(options: TTSEngineOptions): TTSEngine {
  const lang = options.lang ?? "pt-BR";
  const rate = options.rate ?? 0.98;
  const pitch = options.pitch ?? 1.04;
  const volume = options.volume ?? 1;
  const { synthesis, Utterance } = resolveSynthesis();
  const hasBrowserApi = synthesis !== null && Utterance !== null;
  const engineType: TTSEngineType = hasBrowserApi ? "speech-synthesis" : "elevenlabs";

  let activeVoiceName: string | null = null;
  let pendingUtterance: BrowserUtterance | null = null;

  return {
    speak(text: string): void {
      if (!hasBrowserApi || !synthesis || !Utterance) {
        options.onError?.({
          code: "unsupported",
          message: "Síntese de voz indisponível neste navegador.",
        });
        return;
      }

      const cleaned = parseSSML(text);
      const utterance = new Utterance(cleaned);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;

      // Voice selection: prefer named override, else highest-scoring pt-BR.
      const voices =
        typeof synthesis.getVoices === "function" ? synthesis.getVoices() ?? [] : [];
      const picked = pickBestVoice(voices, options.preferredVoice);
      if (picked) {
        activeVoiceName = picked.name;
        utterance.voice = picked as unknown;
      }

      utterance.onstart = () => {
        options.onStart?.();
      };
      utterance.onend = () => {
        if (pendingUtterance === utterance) pendingUtterance = null;
        options.onEnd?.();
      };
      utterance.onerror = (event) => {
        const code = event?.error ?? "unknown";
        if (code === "canceled" || code === "interrupted") {
          options.onError?.({ code: "aborted", message: "Fala cancelada." });
        } else {
          options.onError?.({ code: "synthesis-failed", message: `Erro de TTS: ${code}` });
        }
      };
      utterance.onboundary = (event) => {
        options.onBoundary?.(event);
      };

      pendingUtterance = utterance;
      synthesis.cancel();
      synthesis.speak(utterance);
    },

    cancel(): void {
      if (!synthesis) return;
      pendingUtterance = null;
      synthesis.cancel();
    },

    isAvailable(): boolean {
      return hasBrowserApi;
    },

    getEngineType(): TTSEngineType {
      return engineType;
    },

    getActiveVoiceName(): string | null {
      return activeVoiceName;
    },
  };
}