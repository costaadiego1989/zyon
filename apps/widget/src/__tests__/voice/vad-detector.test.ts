import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVADDetector, type VADOptions } from "../../lib/voice/vad-detector.js";

describe("vad-detector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeOptions(overrides: Partial<VADOptions> = {}): VADOptions {
    return {
      silenceTimeoutMs: 30_000,
      onSilenceTimeout: vi.fn(),
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
      ...overrides,
    };
  }

  it("starts in 'idle' state with no speech activity", () => {
    const detector = createVADDetector(makeOptions());
    expect(detector.getState()).toBe("idle");
    expect(detector.isSpeechActive()).toBe(false);
  });

  it("transitions to 'speech' when speechStart is signalled", () => {
    const opts = makeOptions();
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();

    expect(detector.getState()).toBe("speech");
    expect(detector.isSpeechActive()).toBe(true);
    expect(opts.onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("transitions to 'silence' when speechEnd is signalled", () => {
    const opts = makeOptions();
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();
    detector.signalSpeechEnd();

    expect(detector.getState()).toBe("silence");
    expect(opts.onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("triggers onSilenceTimeout after 30s of silence", () => {
    const opts = makeOptions({ silenceTimeoutMs: 30_000 });
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();
    detector.signalSpeechEnd();

    expect(opts.onSilenceTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(29_999);
    expect(opts.onSilenceTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(opts.onSilenceTimeout).toHaveBeenCalledTimes(1);
  });

  it("resets the silence timer when new speech begins", () => {
    const opts = makeOptions({ silenceTimeoutMs: 5_000 });
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();
    detector.signalSpeechEnd();

    vi.advanceTimersByTime(4_000);
    detector.signalSpeechStart(); // resets timer
    detector.signalSpeechEnd();

    vi.advanceTimersByTime(4_999);
    expect(opts.onSilenceTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(opts.onSilenceTimeout).toHaveBeenCalledTimes(1);
  });

  it("cancel() prevents a pending timeout from firing", () => {
    const opts = makeOptions({ silenceTimeoutMs: 1_000 });
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();
    detector.signalSpeechEnd();

    vi.advanceTimersByTime(500);
    detector.cancel();

    vi.advanceTimersByTime(10_000);
    expect(opts.onSilenceTimeout).not.toHaveBeenCalled();
  });

  it("reset() returns the detector to idle and clears timers", () => {
    const opts = makeOptions({ silenceTimeoutMs: 1_000 });
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();
    detector.signalSpeechEnd();

    detector.reset();
    expect(detector.getState()).toBe("idle");

    vi.advanceTimersByTime(5_000);
    expect(opts.onSilenceTimeout).not.toHaveBeenCalled();
  });

  it("only fires the silence callback once per silence period", () => {
    const opts = makeOptions({ silenceTimeoutMs: 1_000 });
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();
    detector.signalSpeechEnd();

    vi.advanceTimersByTime(2_000);
    expect(opts.onSilenceTimeout).toHaveBeenCalledTimes(1);

    // Additional waiting without new speech must NOT spam the callback.
    vi.advanceTimersByTime(5_000);
    expect(opts.onSilenceTimeout).toHaveBeenCalledTimes(1);
  });

  it("uses configurable silenceTimeoutMs (e.g. 5s for tests)", () => {
    const opts = makeOptions({ silenceTimeoutMs: 5_000 });
    const detector = createVADDetector(opts);
    detector.signalSpeechStart();
    detector.signalSpeechEnd();

    vi.advanceTimersByTime(5_000);
    expect(opts.onSilenceTimeout).toHaveBeenCalledTimes(1);
  });

  it("records last activity timestamp for diagnostics", () => {
    const detector = createVADDetector(makeOptions());
    expect(detector.getLastActivityAt()).toBeNull();

    const before = Date.now();
    detector.signalSpeechStart();
    expect(detector.getLastActivityAt()).not.toBeNull();
    expect(detector.getLastActivityAt()!).toBeGreaterThanOrEqual(before);
  });
});