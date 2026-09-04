import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSTTEngine, type STTEngineOptions } from "../../lib/voice/stt-engine.js";

// Browser SpeechRecognition mock — tests must NOT touch real microphone.
class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  lang = "";
  interimResults = false;
  maxAlternatives = 0;
  continuous = false;
  onstart: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: { results: Array<Array<{ transcript?: string; confidence?: number }>>; resultIndex?: number }) => void) | null = null;

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  start(): void {
    // Real browser fires onstart synchronously inside start(); mirror that.
    this.onstart?.();
  }

  stop(): void {
    this.onend?.();
  }

  abort(): void {
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }

  emit(transcript: string, confidence = 0.92): void {
    this.onresult?.({ results: [[{ transcript, confidence }]], resultIndex: 0 });
  }

  emitError(error: string): void {
    this.onerror?.({ error });
  }
}

function makeOptions(overrides: Partial<STTEngineOptions> = {}): STTEngineOptions {
  return {
    lang: "pt-BR",
    onResult: vi.fn(),
    onError: vi.fn(),
    onStart: vi.fn(),
    onEnd: vi.fn(),
    ...overrides,
  };
}

describe("stt-engine", () => {
  beforeEach(() => {
    MockSpeechRecognition.instances = [];
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);
    vi.stubGlobal("webkitSpeechRecognition", MockSpeechRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects availability when the browser exposes SpeechRecognition", () => {
    const engine = createSTTEngine(makeOptions());
    expect(engine.isAvailable()).toBe(true);
    expect(engine.getEngineType()).toBe("web-speech");
  });

  it("falls back to whisper engine type when SpeechRecognition is missing", () => {
    vi.unstubAllGlobals();
    const engine = createSTTEngine(makeOptions({ fallback: "whisper" }));
    expect(engine.isAvailable()).toBe(false);
    expect(engine.getEngineType()).toBe("whisper");
  });

  it("starts a recognition session with pt-BR locale and emits onStart", () => {
    const opts = makeOptions();
    const engine = createSTTEngine(opts);
    engine.start();

    expect(MockSpeechRecognition.instances).toHaveLength(1);
    const rec = MockSpeechRecognition.instances[0]!;
    expect(rec.lang).toBe("pt-BR");
    expect(rec.interimResults).toBe(true);
    expect(rec.continuous).toBe(false);
    expect(opts.onStart).toHaveBeenCalledTimes(1);
  });

  it("returns transcribed text via onResult with confidence metadata", () => {
    const opts = makeOptions();
    const engine = createSTTEngine(opts);
    engine.start();
    MockSpeechRecognition.instances[0]!.emit("quero uma camiseta preta", 0.88);

    expect(opts.onResult).toHaveBeenCalledWith({
      transcript: "quero uma camiseta preta",
      confidence: 0.88,
      isFinal: true,
    });
  });

  it("maps 'no-speech' errors to a recoverable message and continues", () => {
    const opts = makeOptions();
    const engine = createSTTEngine(opts);
    engine.start();
    MockSpeechRecognition.instances[0]!.emitError("no-speech");

    expect(opts.onError).toHaveBeenCalledWith(
      expect.objectContaining({ recoverable: true, code: "no-speech" }),
    );
  });

  it("marks 'not-allowed' errors as non-recoverable", () => {
    const opts = makeOptions();
    const engine = createSTTEngine(opts);
    engine.start();
    MockSpeechRecognition.instances[0]!.emitError("not-allowed");

    expect(opts.onError).toHaveBeenCalledWith(
      expect.objectContaining({ recoverable: false, code: "not-allowed" }),
    );
  });

  it("stops the recognition session cleanly and emits onEnd", () => {
    const opts = makeOptions();
    const engine = createSTTEngine(opts);
    engine.start();
    engine.stop();

    expect(opts.onEnd).toHaveBeenCalledTimes(1);
  });

  it("tracks consecutive failures for fallback decisions", () => {
    const engine = createSTTEngine(makeOptions());
    expect(engine.getFailureCount()).toBe(0);

    engine.recordFailure();
    engine.recordFailure();
    expect(engine.getFailureCount()).toBe(2);

    engine.recordSuccess();
    expect(engine.getFailureCount()).toBe(0);
  });

  it("shouldFallbackToText returns true after 3 consecutive failures", () => {
    const engine = createSTTEngine(makeOptions({ failureThreshold: 3 }));
    expect(engine.shouldFallbackToText()).toBe(false);

    engine.recordFailure();
    engine.recordFailure();
    expect(engine.shouldFallbackToText()).toBe(false);

    engine.recordFailure();
    expect(engine.shouldFallbackToText()).toBe(true);
  });
});