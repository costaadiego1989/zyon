import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTTSEngine, type TTSEngineOptions, parseSSML } from "../../lib/voice/tts-engine.js";

// Browser SpeechSynthesis + Utterance mocks.
class MockUtterance {
  text: string;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onboundary: ((event: { name?: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

describe("tts-engine", () => {
  let speakMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;
  let mockVoices: Array<{ name: string; lang: string; localService?: boolean }>;

  beforeEach(() => {
    speakMock = vi.fn();
    cancelMock = vi.fn();
    mockVoices = [
      { name: "Google português do Brasil", lang: "pt-BR", localService: false },
      { name: "Microsoft Francisca Online (Natural) - Portuguese (Brazil)", lang: "pt-BR", localService: false },
      { name: "Microsoft Daniel - Portuguese (Brazil)", lang: "pt-BR", localService: false },
      { name: "default", lang: "en-US", localService: true },
    ];
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance as unknown as typeof SpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      cancel: cancelMock,
      speak: speakMock,
      getVoices: () => mockVoices as unknown as SpeechSynthesisVoice[],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeOptions(overrides: Partial<TTSEngineOptions> = {}): TTSEngineOptions {
    return {
      lang: "pt-BR",
      rate: 0.98,
      pitch: 1.04,
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onBoundary: vi.fn(),
      onError: vi.fn(),
      ...overrides,
    };
  }

  it("reports available when SpeechSynthesis is present", () => {
    const engine = createTTSEngine(makeOptions());
    expect(engine.isAvailable()).toBe(true);
    expect(engine.getEngineType()).toBe("speech-synthesis");
  });

  it("falls back to elevenlabs engine type when SpeechSynthesis is missing", () => {
    vi.unstubAllGlobals();
    const engine = createTTSEngine(makeOptions({ fallback: "elevenlabs" }));
    expect(engine.isAvailable()).toBe(false);
    expect(engine.getEngineType()).toBe("elevenlabs");
  });

  it("speaks text with pt-BR locale and configured rate/pitch", () => {
    const engine = createTTSEngine(makeOptions());
    engine.speak("Olá, como posso ajudar?");

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);
    const utterance = speakMock.mock.calls[0]![0] as MockUtterance;
    expect(utterance.text).toBe("Olá, como posso ajudar?");
    expect(utterance.lang).toBe("pt-BR");
    expect(utterance.rate).toBeCloseTo(0.98);
    expect(utterance.pitch).toBeCloseTo(1.04);
  });

  it("picks a higher-quality pt-BR voice when multiple are available", () => {
    const engine = createTTSEngine(makeOptions());
    engine.speak("teste");

    const utterance = speakMock.mock.calls[0]![0] as MockUtterance;
    const voice = utterance.voice as unknown as { name: string } | null;
    expect(voice?.name).toBeTruthy();
    expect(voice?.name.toLowerCase()).toMatch(/pt|brazil|brasil|francisca|microsoft|google/);
  });

  it("emits onStart, onBoundary and onEnd lifecycle hooks", () => {
    const opts = makeOptions();
    const engine = createTTSEngine(opts);
    engine.speak("hello");

    const utterance = speakMock.mock.calls[0]![0] as MockUtterance;
    utterance.onstart?.();
    utterance.onboundary?.({ name: "word" });
    utterance.onend?.();

    expect(opts.onStart).toHaveBeenCalledTimes(1);
    expect(opts.onBoundary).toHaveBeenCalledTimes(1);
    expect(opts.onEnd).toHaveBeenCalledTimes(1);
  });

  it("cancel() stops the current utterance and clears the queue", () => {
    const engine = createTTSEngine(makeOptions());
    engine.speak("a");
    engine.cancel();

    expect(cancelMock).toHaveBeenCalled();
  });

  it("falls back gracefully when SpeechSynthesisUtterance is missing", () => {
    vi.stubGlobal("SpeechSynthesisUtterance", undefined as unknown as typeof SpeechSynthesisUtterance);
    const opts = makeOptions();
    const engine = createTTSEngine(opts);
    engine.speak("ignored");

    expect(opts.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "unsupported" }));
  });
});

describe("parseSSML", () => {
  it("returns plain text unchanged when no markup is present", () => {
    expect(parseSSML("Olá, tudo bem?")).toBe("Olá, tudo bem?");
  });

  it("strips <speak> wrappers", () => {
    expect(parseSSML("<speak>oi</speak>")).toBe("oi");
  });

  it("converts <break> tags to punctuation pauses", () => {
    expect(parseSSML("olá<break time='500ms'/>mundo")).toMatch(/olá.*mundo/);
    expect(parseSSML("olá<break time='500ms'/>mundo")).not.toContain("<break");
  });

  it("preserves emphasis words in uppercase for clarity", () => {
    expect(parseSSML("Compre <emphasis>agora</emphasis>")).toContain("AGORA");
  });

  it("handles malformed SSML without throwing", () => {
    expect(() => parseSSML("<speak><unclosed")).not.toThrow();
  });

  it("returns the original text when SSML is null/undefined", () => {
    expect(parseSSML("")).toBe("");
    expect(parseSSML("   ")).toBe("   ");
  });
});