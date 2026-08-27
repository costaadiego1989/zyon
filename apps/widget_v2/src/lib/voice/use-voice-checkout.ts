import { useCallback, useEffect, useRef, useState } from "react";

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { results: Array<Array<{ transcript?: string }>> }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

export type VoiceCheckoutRiskLevel = "low" | "medium" | "high";

export type VoiceCheckoutField =
  | "email"
  | "cpf"
  | "shipping"
  | "payment"
  | "coupon"
  | "generic";

export type PendingVoiceTurn = {
  id: string;
  rawTranscript: string;
  displayTranscript: string;
  interpretedAction: string;
  riskLevel: VoiceCheckoutRiskLevel;
  field: VoiceCheckoutField;
  requiresTapConfirmation: boolean;
};

export type PendingVoiceTurnDraft = {
  displayTranscript?: string;
  interpretedAction: string;
  riskLevel?: VoiceCheckoutRiskLevel;
  field?: VoiceCheckoutField;
  requiresTapConfirmation?: boolean;
};

function getSpeechRecognitionCtor(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function stripAgentPrefix(text: string): string {
  return text.replace(/^[A-Za-zÀ-ÿ][\wÀ-ÿ]*:\s*/u, "").trim();
}

function createVoiceTurnId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Audio quality: pick the best available pt-BR voice. Browser default voices
// are often robotic; named "natural"/"premium"/cloud voices (Google, Microsoft
// Online, Luciana, Francisca) sound markedly better. We score candidates and
// cache the winner, refreshing when the voice list loads asynchronously.
let cachedPreferredVoice: SpeechSynthesisVoice | null | undefined;

function scorePtBrVoice(voice: SpeechSynthesisVoice): number {
  const lang = voice.lang?.toLowerCase().replace("_", "-") ?? "";
  if (!lang.startsWith("pt")) return -1;

  let score = lang === "pt-br" ? 100 : lang.startsWith("pt") ? 40 : 0;
  const name = voice.name?.toLowerCase() ?? "";

  // Prefer higher-fidelity engines first: cloud/neural voices are dramatically
  // less robotic than the bundled Windows SAPI fallback (the core complaint).
  if (/natural|neural|premium|enhanced/.test(name)) score += 48;
  if (/google/.test(name)) score += 32;
  if (/online|microsoft/.test(name)) score += 22;
  // Clara reads as a warm female agent — prefer named female pt-BR voices when
  // multiple are available (Maria/Francisca/Luciana/Brenda/Thalita/Maria Clara).
  if (/maria|francisca|luciana|brenda|thalita|giovanna|clara|heloisa/.test(name)) score += 16;
  if (/daniel|antonio|fabio|julio|ricardo/.test(name)) score += 8;
  // Local-only fallbacks are usually the lowest quality.
  if (voice.localService && !/natural|neural|premium|enhanced/.test(name)) score -= 8;

  return score;
}

function pickPreferredPtBrVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  if (typeof window.speechSynthesis.getVoices !== "function") return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices?.length) return null;

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = scorePtBrVoice(voice);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return bestScore >= 0 ? best : null;
}

function resolvePreferredPtBrVoice(): SpeechSynthesisVoice | null {
  if (cachedPreferredVoice !== undefined && cachedPreferredVoice !== null) {
    return cachedPreferredVoice;
  }
  const picked = pickPreferredPtBrVoice();
  if (picked) cachedPreferredVoice = picked;
  return picked;
}

// Visual-audio coherence: the on-screen presence orb/waveform should move with
// the *actual* speech, not a decorative loop. We publish a 0..1 "amplitude" on
// a CSS custom property that the UI consumes (transform: scaleY based on it).
// Speech amplitude is driven by real `onboundary` (per-word) events — each word
// kicks the level up, then a rAF loop decays it, producing a natural envelope
// that tracks the spoken cadence even within Web Speech's limits.
const VOICE_AMP_PROP = "--aacp-voice-amp";

function setVoiceAmp(value: number): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  document.documentElement.style.setProperty(VOICE_AMP_PROP, clamped.toFixed(3));
}

function createSpeechAmplitudeController() {
  let raf: number | null = null;
  let level = 0;
  const hasRaf =
    typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";

  const stopLoop = () => {
    if (raf !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(raf);
    }
    raf = null;
  };

  const tick = () => {
    // Exponential decay toward rest; each word boundary re-energizes `level`.
    level *= 0.86;
    setVoiceAmp(level);
    if (level > 0.02) {
      raf = window.requestAnimationFrame(tick);
    } else {
      level = 0;
      setVoiceAmp(0);
      raf = null;
    }
  };

  return {
    // A spoken word just started — punch the level up with a little variation
    // so the waveform never looks mechanically uniform.
    pulse() {
      if (!hasRaf) {
        setVoiceAmp(0.7);
        return;
      }
      level = Math.min(1, 0.62 + Math.random() * 0.38);
      setVoiceAmp(level);
      if (raf === null) raf = window.requestAnimationFrame(tick);
    },
    reset() {
      stopLoop();
      level = 0;
      setVoiceAmp(0);
    },
  };
}

type MicAmplitudeController = {
  start: () => Promise<void>;
  stop: () => void;
};

function createMicAmplitudeController(): MicAmplitudeController {
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let raf: number | null = null;
  let buffer: Uint8Array<ArrayBuffer> | null = null;

  const hasSupport =
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.requestAnimationFrame === "function";

  const stop = () => {
    if (raf !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(raf);
    }
    raf = null;
    source?.disconnect();
    source = null;
    analyser = null;
    buffer = null;
    if (audioCtx && audioCtx.state !== "closed") {
      void audioCtx.close().catch(() => undefined);
    }
    audioCtx = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    stream = null;
    setVoiceAmp(0);
  };

  const tick = () => {
    if (!analyser || !buffer) return;
    analyser.getByteTimeDomainData(buffer);
    // RMS of the centered waveform → perceived loudness in 0..1.
    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const centered = (buffer[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    // Scale + soft clip: quiet rooms still show life, loud speech caps at 1.
    const amp = Math.min(1, rms * 3.2);
    setVoiceAmp(amp);
    raf = window.requestAnimationFrame(tick);
  };

  return {
    async start() {
      if (!hasSupport) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const Ctor =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          stop();
          return;
        }
        audioCtx = new Ctor();
        source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        source.connect(analyser);
        raf = window.requestAnimationFrame(tick);
      } catch {
        // Permission denied / no device — silently fall back to static orb.
        stop();
      }
    },
    stop,
  };
}

export function maskVoiceTranscriptForDisplay(text: string): string {
  return text
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, (email) => {
      const [localPart = "", domain = ""] = email.split("@");
      const visibleLocal =
        localPart.length <= 2 ? `${localPart[0] ?? ""}***` : `${localPart.slice(0, 2)}***`;
      return `${visibleLocal}@${domain}`;
    })
    .replace(/\b(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{2})\b/g, "$1.***.***-$4")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[numero protegido]");
}

function createPendingVoiceTurn(
  transcript: string,
  buildPendingTurn?: (text: string) => PendingVoiceTurnDraft,
): PendingVoiceTurn {
  const draft = buildPendingTurn?.(transcript);

  return {
    id: createVoiceTurnId(),
    rawTranscript: transcript,
    displayTranscript: draft?.displayTranscript ?? maskVoiceTranscriptForDisplay(transcript),
    interpretedAction: draft?.interpretedAction ?? "Enviar esta resposta ao agente.",
    riskLevel: draft?.riskLevel ?? "medium",
    field: draft?.field ?? "generic",
    requiresTapConfirmation: draft?.requiresTapConfirmation ?? true,
  };
}

export type VoiceCheckoutState = {
  listening: boolean;
  speaking: boolean;
  unsupported: boolean;
  hint: string;
  pendingTurn: PendingVoiceTurn | null;
  confirmPendingTurn: () => Promise<void>;
  discardPendingTurn: () => void;
  retryPendingTurn: () => void;
  replayAgentLine: () => void;
  handleMicPress: () => void;
  stopAll: () => void;
};

type UseVoiceCheckoutOptions = {
  enabled: boolean;
  busy: boolean;
  composerLocked: boolean;
  awaitingAgentPlayback: boolean;
  agentPlaybackKey?: string | null;
  latestAgentText: string | null;
  buildPendingTurn?: (text: string) => PendingVoiceTurnDraft;
  onConfirmTranscript: (text: string) => void | Promise<void>;
  onAgentPlaybackDone?: (key: string) => void;
};

export function useVoiceCheckout(options: UseVoiceCheckoutOptions): VoiceCheckoutState {
  const {
    enabled,
    busy,
    composerLocked,
    awaitingAgentPlayback,
    agentPlaybackKey,
    latestAgentText,
    buildPendingTurn,
    onConfirmTranscript,
    onAgentPlaybackDone,
  } = options;

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingVoiceTurn | null>(null);
  const [hint, setHint] = useState("Toque no microfone e responda em voz alta.");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const spokenKeyRef = useRef<string | null>(null);
  const autoListenRef = useRef(false);
  const ampRef = useRef<ReturnType<typeof createSpeechAmplitudeController> | null>(null);
  if (ampRef.current === null) {
    ampRef.current = createSpeechAmplitudeController();
  }
  // Live mic amplitude while the user speaks (drives the same orb/waveform).
  const micAmpRef = useRef<MicAmplitudeController | null>(null);
  if (micAmpRef.current === null) {
    micAmpRef.current = createMicAmplitudeController();
  }
  const buildPendingTurnRef = useRef(buildPendingTurn);
  const onConfirmTranscriptRef = useRef(onConfirmTranscript);
  const onAgentPlaybackDoneRef = useRef(onAgentPlaybackDone);
  // P2: refs that are always current so async handlers (utterance.onend) never
  // read stale busy/composerLocked/awaitingAgentPlayback values from a closure.
  const busyRef = useRef(busy);
  const composerLockedRef = useRef(composerLocked);
  const awaitingAgentPlaybackRef = useRef(awaitingAgentPlayback);

  useEffect(() => {
    buildPendingTurnRef.current = buildPendingTurn;
  }, [buildPendingTurn]);

  useEffect(() => {
    onConfirmTranscriptRef.current = onConfirmTranscript;
  }, [onConfirmTranscript]);

  useEffect(() => {
    onAgentPlaybackDoneRef.current = onAgentPlaybackDone;
  }, [onAgentPlaybackDone]);

  // P2: keep refs in sync with latest prop values on every render.
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { composerLockedRef.current = composerLocked; }, [composerLocked]);
  // P3: consume awaitingAgentPlayback by tracking it in a ref so the onend
  // handler can gate auto-listen on it; removes the dead-parameter smell.
  useEffect(() => { awaitingAgentPlaybackRef.current = awaitingAgentPlayback; }, [awaitingAgentPlayback]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    micAmpRef.current?.stop();
    setListening(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    ampRef.current?.reset();
    setSpeaking(false);
  }, []);

  const stopAll = useCallback(() => {
    stopListening();
    stopSpeaking();
  }, [stopListening, stopSpeaking]);

  useEffect(() => {
    if (!enabled) {
      stopAll();
      spokenKeyRef.current = null;
      autoListenRef.current = false;
      setPendingTurn(null);
      setHint("Toque no microfone e responda em voz alta.");
      return;
    }

    if (typeof window === "undefined") return;
    if (!getSpeechRecognitionCtor()) {
      setUnsupported(true);
      setHint("Seu navegador ainda não suporta voz aqui. Use o chat para continuar.");
    }
  }, [enabled, stopAll]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    if (typeof synth.addEventListener !== "function") return;
    // pt-BR voices often populate asynchronously; (re)resolve the preferred
    // voice when the list changes so the first utterance can still use it.
    const refresh = () => {
      const picked = pickPreferredPtBrVoice();
      if (picked) cachedPreferredVoice = picked;
    };
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => {
      synth.removeEventListener?.("voiceschanged", refresh);
    };
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      micAmpRef.current?.stop();
      stopSpeaking();
    };
  }, [stopSpeaking]);

  const startListening = useCallback(async () => {
    if (!enabled || busy || composerLocked || speaking) return;

    const SpeechRecognitionClass = getSpeechRecognitionCtor();
    if (!SpeechRecognitionClass) {
      setUnsupported(true);
      setHint("Seu navegador ainda não suporta voz aqui. Use o chat para continuar.");
      return;
    }

    stopSpeaking();
    const recognition = new SpeechRecognitionClass();
    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setListening(true);
      setHint("Estou ouvindo...");
      // Open the live mic meter so the orb/waveform reacts to the user's voice.
      void micAmpRef.current?.start();
    };

    recognition.onerror = (event) => {
      micAmpRef.current?.stop();
      setListening(false);
      const error = event?.error ?? "";
      // Benign: no speech detected or we aborted the session ourselves. These
      // fire constantly (e.g. a brief pause right after tapping) and must NOT
      // surface a scary "não captei" — just invite another try calmly.
      if (error === "no-speech" || error === "aborted" || error === "") {
        setHint("Não ouvi nada. Toque e fale quando quiser.");
        return;
      }
      // Permission problems need a distinct, actionable message.
      if (error === "not-allowed" || error === "service-not-allowed") {
        setHint("Preciso de permissão do microfone. Libere o acesso ou use o chat.");
        return;
      }
      if (error === "audio-capture") {
        setHint("Não encontrei um microfone. Verifique o dispositivo ou use o chat.");
        return;
      }
      if (error === "network") {
        setHint("Falha de rede no reconhecimento de voz. Tente de novo ou use o chat.");
        return;
      }
      setHint("Não captei bem. Tente de novo ou mude para o chat.");
    };

    recognition.onend = () => {
      micAmpRef.current?.stop();
      setListening(false);
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) {
        setHint("Não entendi. Pode repetir?");
        return;
      }
      setPendingTurn(createPendingVoiceTurn(transcript, buildPendingTurnRef.current));
      setHint("Confira o que entendi antes de enviar.");
    };

    try {
      recognition.start();
    } catch {
      micAmpRef.current?.stop();
      setHint("Microfone indisponível. Verifique permissões ou use o chat.");
      setListening(false);
    }
  }, [busy, composerLocked, enabled, speaking, stopSpeaking]);

  const discardPendingTurn = useCallback(() => {
    setPendingTurn(null);
    setHint("Toque no microfone quando quiser responder.");
  }, []);

  const retryPendingTurn = useCallback(() => {
    setPendingTurn(null);
    setHint("Pode falar de novo. Estou ouvindo.");
    autoListenRef.current = false;
    void startListening();
  }, [startListening]);

  const confirmPendingTurn = useCallback(async () => {
    if (!pendingTurn || busy || composerLocked) return;

    const turn = pendingTurn;
    setPendingTurn(null);
    setHint("Enviando sua resposta confirmada.");

    try {
      await onConfirmTranscriptRef.current(turn.rawTranscript);
      setHint("Resposta enviada. Vou continuar daqui.");
    } catch {
      setPendingTurn(turn);
      setHint("Não consegui enviar agora. Confirme novamente ou tente pelo chat.");
    }
  }, [busy, composerLocked, pendingTurn]);

  const speakAgentLine = useCallback(
    (text: string, playbackKey?: string | null) => {
      const markPlaybackDone = () => {
        if (playbackKey) onAgentPlaybackDoneRef.current?.(playbackKey);
      };

      if (
        !enabled ||
        typeof window === "undefined" ||
        !window.speechSynthesis ||
        typeof SpeechSynthesisUtterance === "undefined"
      ) {
        markPlaybackDone();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(stripAgentPrefix(text));
      utterance.lang = "pt-BR";
      // Audio quality tuning. The Windows default pt-BR SAPI voice sounds robotic
      // mostly because of its flat, slightly-too-fast delivery. A marginally
      // slower rate (0.98) plus a touch more pitch (1.04) reads warmer and more
      // human for conversational copy, and gives the picked neural/cloud voice
      // (see scorePtBrVoice) room to breathe. A higher-fidelity pt-BR voice is
      // selected when the browser exposes one.
      utterance.rate = 0.98;
      utterance.pitch = 1.04;
      utterance.volume = 1;
      const preferredVoice = resolvePreferredPtBrVoice();
      if (preferredVoice) utterance.voice = preferredVoice;
      utterance.onstart = () => {
        setSpeaking(true);
        stopListening();
        ampRef.current?.pulse();
        setHint("Estou falando com você...");
      };
      // Real per-word boundary events drive the visual amplitude so the orb and
      // waveform move in time with the actual speech — visual-audio coherence.
      utterance.onboundary = () => {
        ampRef.current?.pulse();
      };
      utterance.onend = () => {
        setSpeaking(false);
        ampRef.current?.reset();
        markPlaybackDone();
        setHint("Toque no microfone quando quiser responder.");
        // P2: read current values from refs instead of the stale closure
        // values of busy/composerLocked/awaitingAgentPlayback. The onend
        // callback fires asynchronously (seconds later); without refs it would
        // re-open the mic even when the app has since become busy/locked.
        // P3: also gate on awaitingAgentPlayback so callers can suppress
        // auto-listen when another agent line is already queued.
        if (
          autoListenRef.current &&
          !busyRef.current &&
          !composerLockedRef.current &&
          !awaitingAgentPlaybackRef.current
        ) {
          void startListening();
        }
      };
      utterance.onerror = () => {
        setSpeaking(false);
        ampRef.current?.reset();
        markPlaybackDone();
        setHint("Toque no microfone quando quiser responder.");
      };

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    // P2: remove busy/composerLocked from deps — they are now read via refs
    // inside the callback so there is no closure capture to invalidate.
    [enabled, startListening, stopListening],
  );

  useEffect(() => {
    if (!enabled || !latestAgentText || busy) return;
    const spokenKey = agentPlaybackKey ?? latestAgentText;
    if (spokenKeyRef.current === spokenKey) return;
    spokenKeyRef.current = spokenKey;
    autoListenRef.current = true;
    speakAgentLine(latestAgentText, agentPlaybackKey);
  }, [agentPlaybackKey, busy, enabled, latestAgentText, speakAgentLine]);

  function replayAgentLine(): void {
    if (!latestAgentText || busy) return;
    autoListenRef.current = false;
    spokenKeyRef.current = null;
    speakAgentLine(latestAgentText);
  }

  function handleMicPress(): void {
    if (unsupported) return;
    if (pendingTurn) {
      setHint("Confirme, edite ou fale de novo antes de continuar.");
      return;
    }
    if (listening) {
      stopListening();
      setHint("Toque no microfone quando quiser responder.");
      return;
    }
    autoListenRef.current = false;
    void startListening();
  }

  return {
    listening,
    speaking,
    unsupported,
    hint,
    pendingTurn,
    confirmPendingTurn,
    discardPendingTurn,
    retryPendingTurn,
    replayAgentLine,
    handleMicPress,
    stopAll,
  };
}
