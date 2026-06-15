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

export type VoiceCheckoutState = {
  listening: boolean;
  speaking: boolean;
  unsupported: boolean;
  hint: string;
  handleMicPress: () => void;
  stopAll: () => void;
};

type UseVoiceCheckoutOptions = {
  enabled: boolean;
  busy: boolean;
  composerLocked: boolean;
  awaitingAgentPlayback: boolean;
  latestAgentText: string | null;
  onTranscript: (text: string) => void | Promise<void>;
};

export function useVoiceCheckout(options: UseVoiceCheckoutOptions): VoiceCheckoutState {
  const {
    enabled,
    busy,
    composerLocked,
    awaitingAgentPlayback,
    latestAgentText,
    onTranscript,
  } = options;

  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [hint, setHint] = useState("Toque no microfone e responda em voz alta.");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const spokenKeyRef = useRef<string | null>(null);
  const autoListenRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

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
      setHint("Estou ouvindo…");
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
      setHint(`Você disse: “${transcript}”`);
      void onTranscriptRef.current(transcript);
    };

    try {
      recognition.start();
    } catch {
      setHint("Microfone indisponível. Verifique permissões ou use o chat.");
      setListening(false);
    }
  }, [busy, composerLocked, enabled, speaking, stopSpeaking]);

  const speakAgentLine = useCallback(
    (text: string) => {
      if (!enabled || typeof window === "undefined" || !window.speechSynthesis) return;

      const utterance = new SpeechSynthesisUtterance(stripAgentPrefix(text));
      utterance.lang = "pt-BR";
      utterance.rate = 1;
      utterance.onstart = () => {
        setSpeaking(true);
        stopListening();
        setHint("Estou falando com você…");
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
    handleMicPress,
    stopAll,
  };
}
