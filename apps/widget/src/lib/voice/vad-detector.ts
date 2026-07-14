// Voice Activity Detection (VAD) — REQ-VC-001 / REQ-VC-005.
//
// Pure-software VAD that tracks the buyer's speech-vs-silence state. The browser
// itself doesn't expose raw audio amplitude through Web Speech API, so we infer
// activity from the recognition lifecycle signals (speechStart/speechEnd) plus
// a configurable silence timer. When silence exceeds the timeout (default
// 30_000 ms), we fire `onSilenceTimeout` once per silence period — callers use
// that to nudge the buyer ("Ainda está aí?").
//
// `silenceTimeoutMs: 30_000` matches the spec. Tests override to a small value
// to keep the suite fast.

export type VADState = "idle" | "speech" | "silence";

export type VADOptions = {
  silenceTimeoutMs?: number;
  onSilenceTimeout: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
};

export type VADDetector = {
  signalSpeechStart: () => void;
  signalSpeechEnd: () => void;
  cancel: () => void;
  reset: () => void;
  getState: () => VADState;
  isSpeechActive: () => boolean;
  getLastActivityAt: () => number | null;
};

export function createVADDetector(options: VADOptions): VADDetector {
  const silenceTimeoutMs = options.silenceTimeoutMs ?? 30_000;
  let state: VADState = "idle";
  let lastActivityAt: number | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceFired = false;

  function clearSilenceTimer(): void {
    if (silenceTimer === null) return;
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  function armSilenceTimer(): void {
    clearSilenceTimer();
    silenceFired = false;
    silenceTimer = setTimeout(() => {
      silenceFired = true;
      options.onSilenceTimeout();
    }, silenceTimeoutMs);
  }

  return {
    signalSpeechStart(): void {
      clearSilenceTimer();
      silenceFired = false;
      lastActivityAt = Date.now();
      if (state !== "speech") {
        state = "speech";
        options.onSpeechStart?.();
      }
    },

    signalSpeechEnd(): void {
      lastActivityAt = Date.now();
      if (state !== "silence") {
        state = "silence";
        options.onSpeechEnd?.();
      }
      armSilenceTimer();
    },

    cancel(): void {
      clearSilenceTimer();
      silenceFired = false;
      state = "idle";
      lastActivityAt = null;
    },

    reset(): void {
      clearSilenceTimer();
      silenceFired = false;
      state = "idle";
      lastActivityAt = null;
    },

    getState(): VADState {
      return state;
    },

    isSpeechActive(): boolean {
      return state === "speech";
    },

    getLastActivityAt(): number | null {
      return lastActivityAt;
    },
  };
}

// Suppress an unused-warning hint for `silenceFired` — it is part of the
// documented "fires once per silence period" contract even though we currently
// drive it via cancel/reset. Keeping it exported in spirit for future use.
void ({} as { silenceFired: boolean });