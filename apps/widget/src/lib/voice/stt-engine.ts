// STT engine — Web Speech API wrapper with Whisper fallback detection.
//
// Browser Web Speech API is the primary engine (free, no key). When unavailable
// (Firefox/Safari/non-https contexts), the engine reports its type as "whisper"
// so the calling layer can swap in a server-side fallback later. The engine
// itself only performs client-side transcription; audio NEVER leaves the device
// (REQ-VC-007).
//
// Errors are mapped to a normalized {code, recoverable, message} shape so the UI
// layer can decide whether to retry, switch to text, or surface a permission
// prompt. A consecutive-failure counter drives the REQ-VC-005 "3 strikes → text
// mode" fallback without leaking that policy into the UI layer.

export type STTEngineType = "web-speech" | "whisper";

export type STTErrorCode =
  | "no-speech"
  | "aborted"
  | "not-allowed"
  | "service-not-allowed"
  | "audio-capture"
  | "network"
  | "language-not-supported"
  | "unsupported"
  | "unknown";

export type STTResult = {
  transcript: string;
  confidence: number;
  isFinal: boolean;
};

export type STTError = {
  code: STTErrorCode;
  message: string;
  recoverable: boolean;
};

export type STTEngineOptions = {
  lang?: string;
  interimResults?: boolean;
  continuous?: boolean;
  maxAlternatives?: number;
  failureThreshold?: number;
  fallback?: "whisper";
  onResult: (result: STTResult) => void;
  onError: (error: STTError) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

// Minimal subset of the browser SpeechRecognition surface that we touch. We keep
// this local to avoid leaking global types into unit tests.
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onresult:
    | ((event: {
        results: Array<Array<{ transcript?: string; confidence?: number }>>;
        resultIndex?: number;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function resolveSpeechRecognitionCtor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const RECOVERABLE_CODES: ReadonlySet<STTErrorCode> = new Set([
  "no-speech",
  "aborted",
  "network",
  "audio-capture",
  "language-not-supported",
  "unknown",
]);

function describeError(code: string): { code: STTErrorCode; message: string; recoverable: boolean } {
  switch (code) {
    case "no-speech":
      return { code: "no-speech", message: "Não ouvi nada. Tente de novo.", recoverable: true };
    case "aborted":
      return { code: "aborted", message: "Reconhecimento cancelado.", recoverable: true };
    case "not-allowed":
    case "service-not-allowed":
      return {
        code: code as STTErrorCode,
        message: "Sem permissão de microfone.",
        recoverable: false,
      };
    case "audio-capture":
      return {
        code: "audio-capture",
        message: "Microfone indisponível.",
        recoverable: true,
      };
    case "network":
      return { code: "network", message: "Falha de rede no reconhecimento.", recoverable: true };
    case "language-not-supported":
      return {
        code: "language-not-supported",
        message: "Idioma não suportado pelo navegador.",
        recoverable: true,
      };
    default:
      return { code: "unknown", message: "Não captei bem.", recoverable: true };
  }
}

export type STTEngine = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  isAvailable: () => boolean;
  getEngineType: () => STTEngineType;
  getFailureCount: () => number;
  recordFailure: () => void;
  recordSuccess: () => void;
  shouldFallbackToText: () => boolean;
  getLang: () => string;
};

export function createSTTEngine(options: STTEngineOptions): STTEngine {
  const lang = options.lang ?? "pt-BR";
  const failureThreshold = options.failureThreshold ?? 3;
  const Ctor = resolveSpeechRecognitionCtor();
  let recognition: BrowserSpeechRecognition | null = null;
  let failureCount = 0;
  const hasBrowserApi = Ctor !== null;
  const engineType: STTEngineType = hasBrowserApi ? "web-speech" : "whisper";

  function emitError(code: string): void {
    const meta = describeError(code);
    options.onError({
      code: meta.code,
      message: meta.message,
      recoverable: RECOVERABLE_CODES.has(meta.code),
    });
  }

  return {
    start(): void {
      if (!hasBrowserApi || !Ctor) {
        options.onError({
          code: "unsupported",
          message: "Reconhecimento de voz indisponível neste navegador.",
          recoverable: false,
        });
        return;
      }
      const rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = options.interimResults ?? true;
      rec.maxAlternatives = 1;
      rec.continuous = options.continuous ?? false;
      recognition = rec;

      rec.onstart = () => {
        // Synchronous: matches the real browser behavior closely enough and lets
        // tests assert onStart immediately without draining microtasks.
        options.onStart?.();
      };
      rec.onerror = (event) => {
        emitError(event?.error ?? "unknown");
      };
      rec.onend = () => {
        recognition = null;
        options.onEnd?.();
      };
      rec.onresult = (event) => {
        const results = event.results ?? [];
        if (!results.length) return;
        const lastResult = results[results.length - 1]!;
        const alternative = lastResult[0];
        const transcript = alternative?.transcript?.trim() ?? "";
        if (!transcript) return;
        options.onResult({
          transcript,
          confidence: alternative?.confidence ?? 0,
          isFinal: true,
        });
      };

      try {
        rec.start();
      } catch (err) {
        emitError(err instanceof Error ? err.message : "unknown");
      }
    },

    stop(): void {
      if (!recognition) return;
      try {
        recognition.stop();
      } catch {
        // Some browsers throw if stop() races with onend; safe to swallow.
      }
    },

    abort(): void {
      if (!recognition) return;
      try {
        recognition.abort();
      } catch {
        // noop
      }
    },

    isAvailable(): boolean {
      return hasBrowserApi;
    },

    getEngineType(): STTEngineType {
      return engineType;
    },

    getFailureCount(): number {
      return failureCount;
    },

    recordFailure(): void {
      failureCount += 1;
    },

    recordSuccess(): void {
      failureCount = 0;
    },

    shouldFallbackToText(): boolean {
      return failureCount >= failureThreshold;
    },

    getLang(): string {
      return lang;
    },
  };
}