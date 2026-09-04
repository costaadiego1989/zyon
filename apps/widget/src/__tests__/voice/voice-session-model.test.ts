import { describe, expect, it } from "vitest";
import {
  createVoiceSession,
  type VoiceSessionState,
  type VoiceTransition,
} from "../../lib/voice/voice-session.js";

describe("voice-session state machine", () => {
  it("starts in 'idle' state", () => {
    const session = createVoiceSession();
    expect(session.getState()).toBe<VoiceSessionState>("idle");
  });

  it("transitions idle -> listening on START_LISTENING", () => {
    const session = createVoiceSession();
    session.dispatch({ type: "START_LISTENING" });
    expect(session.getState()).toBe<VoiceSessionState>("listening");
  });

  it("transitions listening -> processing on SPEECH_CAPTURED", () => {
    const session = createVoiceSession();
    session.dispatch({ type: "START_LISTENING" });
    session.dispatch({ type: "SPEECH_CAPTURED", transcript: "oi" });
    expect(session.getState()).toBe<VoiceSessionState>("processing");
  });

  it("transitions processing -> speaking on AGENT_RESPONSE_READY", () => {
    const session = createVoiceSession();
    session.dispatch({ type: "START_LISTENING" });
    session.dispatch({ type: "SPEECH_CAPTURED", transcript: "oi" });
    session.dispatch({ type: "AGENT_RESPONSE_READY", text: "olá" });
    expect(session.getState()).toBe<VoiceSessionState>("speaking");
  });

  it("transitions speaking -> listening on SPEECH_ENDED when autoListen", () => {
    const session = createVoiceSession();
    session.dispatch({ type: "START_LISTENING" });
    session.dispatch({ type: "SPEECH_CAPTURED", transcript: "oi" });
    session.dispatch({ type: "AGENT_RESPONSE_READY", text: "olá" });
    session.dispatch({ type: "SPEECH_ENDED" });
    expect(session.getState()).toBe<VoiceSessionState>("listening");
  });

  it("transitions speaking -> idle on SPEECH_ENDED without autoListen", () => {
    const session = createVoiceSession();
    session.dispatch({ type: "START_LISTENING" });
    session.dispatch({ type: "SPEECH_CAPTURED", transcript: "oi" });
    session.dispatch({ type: "AGENT_RESPONSE_READY", text: "olá" });
    session.dispatch({ type: "SET_AUTO_LISTEN", value: false });
    session.dispatch({ type: "SPEECH_ENDED" });
    expect(session.getState()).toBe<VoiceSessionState>("idle");
  });

  it("transitions any state -> idle on CANCEL", () => {
    const session = createVoiceSession();
    session.dispatch({ type: "START_LISTENING" });
    session.dispatch({ type: "CANCEL" });
    expect(session.getState()).toBe<VoiceSessionState>("idle");
  });

  it("emits transitions through subscriber callbacks", () => {
    const session = createVoiceSession();
    const observed: Array<{ from: VoiceSessionState; to: VoiceSessionState; type: VoiceTransition["type"] }> = [];
    const unsub = session.subscribe((event) => {
      observed.push({ from: event.from, to: event.to, type: event.type });
    });

    session.dispatch({ type: "START_LISTENING" });
    session.dispatch({ type: "SPEECH_CAPTURED", transcript: "oi" });
    session.dispatch({ type: "CANCEL" });
    unsub();

    expect(observed).toEqual([
      { from: "idle", to: "listening", type: "START_LISTENING" },
      { from: "listening", to: "processing", type: "SPEECH_CAPTURED" },
      { from: "processing", to: "idle", type: "CANCEL" },
    ]);
  });

  it("ignores invalid transitions gracefully", () => {
    const session = createVoiceSession();
    // SPEECH_CAPTURED from idle is invalid — should stay idle.
    session.dispatch({ type: "SPEECH_CAPTURED", transcript: "oi" });
    expect(session.getState()).toBe<VoiceSessionState>("idle");
  });

  it("tracks autoListen flag independent of state", () => {
    const session = createVoiceSession();
    expect(session.isAutoListenEnabled()).toBe(true);

    session.dispatch({ type: "SET_AUTO_LISTEN", value: false });
    expect(session.isAutoListenEnabled()).toBe(false);

    session.dispatch({ type: "SET_AUTO_LISTEN", value: true });
    expect(session.isAutoListenEnabled()).toBe(true);
  });

  it("tracks consecutive STT failure count", () => {
    const session = createVoiceSession();
    expect(session.getSttFailureCount()).toBe(0);

    session.dispatch({ type: "STT_FAILURE" });
    session.dispatch({ type: "STT_FAILURE" });
    session.dispatch({ type: "STT_FAILURE" });
    expect(session.getSttFailureCount()).toBe(3);

    session.dispatch({ type: "STT_SUCCESS" });
    expect(session.getSttFailureCount()).toBe(0);
  });

  it("marks session as textFallback after 3 STT failures", () => {
    const session = createVoiceSession({ sttFailureThreshold: 3 });
    session.dispatch({ type: "STT_FAILURE" });
    session.dispatch({ type: "STT_FAILURE" });
    expect(session.isTextFallback()).toBe(false);

    session.dispatch({ type: "STT_FAILURE" });
    expect(session.isTextFallback()).toBe(true);
  });
});