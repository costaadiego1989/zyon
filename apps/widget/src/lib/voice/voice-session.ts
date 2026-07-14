// Voice session state machine — REQ-VC-003 / REQ-VC-004.
//
// The session is the single source of truth for the voice channel's high-level
// state (idle | listening | processing | speaking). Components subscribe via
// `subscribe()` and dispatch typed transitions. Invalid transitions are ignored
// so the UI never observes an out-of-order state.
//
// The session also tracks derived concerns (autoListen flag, STT failure count,
// textFallback flag) so the caller doesn't need to keep a parallel bag of refs.

export type VoiceSessionState = "idle" | "listening" | "processing" | "speaking";

export type VoiceTransition =
  | { type: "START_LISTENING" }
  | { type: "STOP_LISTENING" }
  | { type: "SPEECH_CAPTURED"; transcript: string }
  | { type: "AGENT_RESPONSE_READY"; text: string }
  | { type: "SPEECH_ENDED" }
  | { type: "PROCESSING_FAILED" }
  | { type: "CANCEL" }
  | { type: "RESET" }
  | { type: "SET_AUTO_LISTEN"; value: boolean }
  | { type: "STT_FAILURE" }
  | { type: "STT_SUCCESS" }
  | { type: "MARK_TEXT_FALLBACK" };

export type VoiceSessionEvent = {
  from: VoiceSessionState;
  to: VoiceSessionState;
  type: VoiceTransition["type"];
};

export type VoiceSessionOptions = {
  initialState?: VoiceSessionState;
  initialAutoListen?: boolean;
  sttFailureThreshold?: number;
};

export type VoiceSession = {
  getState: () => VoiceSessionState;
  dispatch: (transition: VoiceTransition) => void;
  subscribe: (listener: (event: VoiceSessionEvent) => void) => () => void;
  isAutoListenEnabled: () => boolean;
  getSttFailureCount: () => number;
  isTextFallback: () => boolean;
  getCapturedTranscript: () => string;
};

const VALID_TRANSITIONS: Record<VoiceSessionState, ReadonlySet<VoiceTransition["type"]>> = {
  idle: new Set(["START_LISTENING", "RESET"]),
  listening: new Set(["STOP_LISTENING", "SPEECH_CAPTURED", "CANCEL"]),
  processing: new Set(["AGENT_RESPONSE_READY", "PROCESSING_FAILED", "CANCEL"]),
  speaking: new Set(["SPEECH_ENDED", "CANCEL"]),
};

export function createVoiceSession(options: VoiceSessionOptions = {}): VoiceSession {
  let state: VoiceSessionState = options.initialState ?? "idle";
  let autoListen = options.initialAutoListen ?? true;
  let sttFailureCount = 0;
  let textFallback = false;
  let capturedTranscript = "";
  const threshold = options.sttFailureThreshold ?? 3;

  const listeners = new Set<(event: VoiceSessionEvent) => void>();

  function emit(from: VoiceSessionState, to: VoiceSessionState, type: VoiceTransition["type"]): void {
    if (from === to) return;
    const event: VoiceSessionEvent = { from, to, type };
    for (const listener of listeners) listener(event);
  }

  function transition(next: VoiceSessionState, type: VoiceTransition["type"]): void {
    const allowed = VALID_TRANSITIONS[state];
    if (!allowed.has(type)) {
      // Invalid transition — silently ignore. Keeps the machine total.
      return;
    }
    const prev = state;
    state = next;
    emit(prev, state, type);
  }

  function dispatch(t: VoiceTransition): void {
    switch (t.type) {
      case "START_LISTENING":
        transition("listening", t.type);
        return;
      case "STOP_LISTENING":
        transition("idle", t.type);
        return;
      case "SPEECH_CAPTURED":
        capturedTranscript = t.transcript;
        transition("processing", t.type);
        return;
      case "AGENT_RESPONSE_READY":
        transition("speaking", t.type);
        return;
      case "SPEECH_ENDED":
        transition(autoListen ? "listening" : "idle", t.type);
        return;
      case "PROCESSING_FAILED":
        transition("idle", t.type);
        return;
      case "CANCEL":
        transition("idle", t.type);
        return;
      case "RESET":
        transition("idle", t.type);
        capturedTranscript = "";
        autoListen = options.initialAutoListen ?? true;
        return;
      case "SET_AUTO_LISTEN":
        autoListen = t.value;
        return;
      case "STT_FAILURE":
        sttFailureCount += 1;
        if (sttFailureCount >= threshold) textFallback = true;
        return;
      case "STT_SUCCESS":
        sttFailureCount = 0;
        textFallback = false;
        return;
      case "MARK_TEXT_FALLBACK":
        textFallback = true;
        return;
      default: {
        const _exhaustive: never = t;
        void _exhaustive;
      }
    }
  }

  return {
    getState: () => state,
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isAutoListenEnabled: () => autoListen,
    getSttFailureCount: () => sttFailureCount,
    isTextFallback: () => textFallback,
    getCapturedTranscript: () => capturedTranscript,
  };
}