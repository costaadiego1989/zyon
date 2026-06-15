import { useCallback, useEffect, useRef, useState } from "react";

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: (() => void) | null;
  onerror: (() => void) | null;
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
  handleMicPress: () => void;
  stopAll: () => void;
};

type UseVoiceCheckoutOptions = {
  enabled: boolean;
  busy: boolean;
  composerLocked: boolean;
  awaitingAgentPlayback: boolean;
  latestAgentText: string | null;
  buildPendingTurn?: (text: string) => PendingVoiceTurnDraft;
  onConfirmTranscript: (text: string) => void | Promise<void>;
};

export function useVoiceCheckout(options: UseVoiceCheckoutOptions): VoiceCheckoutState {
  const {
    enabled,
    busy,
    composerLocked,
    awaitingAgentPlayback,
    latestAgentText,
    buildPendingTurn,
    onConfirmTranscript,
  } = options;

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [pendingTurn, setPendingTurn] = useState<PendingVoiceTurn | null>(null);
  const [hint, setHint] = useState("Toque no microfone e responda em voz alta.");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const spokenKeyRef = useRef<string | null>(null);
  const autoListenRef = useRef(false);
  const buildPendingTurnRef = useRef(buildPendingTurn);
  const onConfirmTranscriptRef = useRef(onConfirmTranscript);

  useEffect(() => {
    buildPendingTurnRef.current = buildPendingTurn;
  }, [buildPendingTurn]);

  useEffect(() => {
    onConfirmTranscriptRef.current = onConfirmTranscript;
  }, [onConfirmTranscript]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
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
    return () => {
      recognitionRef.current?.abort();
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
    };

    recognition.onerror = () => {
      setListening(false);
      setHint("Não captei bem. Tente de novo ou mude para o chat.");
    };

    recognition.onend = () => {
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
    (text: string) => {
      if (!enabled || typeof window === "undefined" || !window.speechSynthesis) return;

      const utterance = new SpeechSynthesisUtterance(stripAgentPrefix(text));
      utterance.lang = "pt-BR";
      utterance.rate = 1;
      utterance.onstart = () => {
        setSpeaking(true);
        stopListening();
        setHint("Estou falando com você...");
      };
      utterance.onend = () => {
        setSpeaking(false);
        setHint("Toque no microfone quando quiser responder.");
        if (autoListenRef.current && !busy && !composerLocked) {
          void startListening();
        }
      };
      utterance.onerror = () => {
        setSpeaking(false);
        setHint("Toque no microfone quando quiser responder.");
      };

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [busy, composerLocked, enabled, startListening, stopListening],
  );

  useEffect(() => {
    if (!enabled || !latestAgentText || awaitingAgentPlayback || busy) return;
    if (spokenKeyRef.current === latestAgentText) return;
    spokenKeyRef.current = latestAgentText;
    autoListenRef.current = true;
    speakAgentLine(latestAgentText);
  }, [awaitingAgentPlayback, busy, enabled, latestAgentText, speakAgentLine]);

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
    handleMicPress,
    stopAll,
  };
}
