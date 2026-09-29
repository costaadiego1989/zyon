"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RealtimeClientSecret = { value: string; expires_at?: number };
type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  response?: {
    status?: string;
    output?: Array<{ content?: Array<{ transcript?: string; text?: string }> }>;
  };
};
type VoiceError = Error & { status?: number };

export type ProductNarrationProgress = {
  status: "idle" | "connecting" | "playing" | "blocked" | "completed" | "error";
  hint: string;
  transcript: string;
};

type Options = {
  enabled: boolean;
  createSession: (summary: string) => Promise<RealtimeClientSecret>;
  onProgress?: (progress: ProductNarrationProgress) => void;
};

export type RealtimeProductNarrationState = {
  connecting: boolean;
  speaking: boolean;
  hint: string;
  play: (summary: string) => void;
  stop: () => void;
};

/**
 * A deliberately narrow Realtime client for the product "Ouvir resumo" action.
 *
 * It receives audio only: no microphone, no commerce callbacks and no checkout
 * tools. Keeping it separate from useRealtimeVoiceCheckout prevents a product
 * narration from changing the buyer's selected chat/voice purchase channel.
 */
export function useRealtimeProductNarration({ enabled, createSession, onProgress }: Options): RealtimeProductNarrationState {
  const [connecting, setConnecting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [hint, setHint] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const attemptRef = useRef(0);
  const transcriptRef = useRef("");
  const finishTimerRef = useRef<number | null>(null);
  const createSessionRef = useRef(createSession);
  const onProgressRef = useRef(onProgress);
  createSessionRef.current = createSession;
  onProgressRef.current = onProgress;

  const publish = useCallback((progress: ProductNarrationProgress) => {
    setConnecting(progress.status === "connecting");
    setSpeaking(progress.status === "playing");
    setHint(progress.hint);
    onProgressRef.current?.(progress);
  }, []);

  const clearFinishTimer = useCallback(() => {
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
  }, []);

  const release = useCallback(() => {
    clearFinishTimer();
    const channel = channelRef.current;
    const peer = peerRef.current;
    channelRef.current = null;
    peerRef.current = null;
    channel?.close();
    peer?.close();
    const audio = audioRef.current;
    audio?.pause();
    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }
    audioRef.current = null;
  }, [clearFinishTimer]);

  const stop = useCallback(() => {
    attemptRef.current += 1;
    release();
    publish({ status: "idle", hint: "", transcript: "" });
  }, [publish, release]);

  const resumeAudio = useCallback((attempt: number, audio = audioRef.current) => {
    if (!audio?.srcObject || attempt !== attemptRef.current) return false;
    void audio.play()
      .then(() => {
        if (attempt !== attemptRef.current) return;
        publish({ status: "playing", hint: "Reproduzindo o resumo...", transcript: transcriptRef.current });
      })
      .catch(() => {
        if (attempt !== attemptRef.current) return;
        // The track and session remain live. A second tap now resumes this
        // exact track instead of spending another narration session.
        publish({ status: "blocked", hint: "Toque em Reproduzir resumo para iniciar o áudio.", transcript: transcriptRef.current });
      });
    return true;
  }, [publish]);

  const completeSession = useCallback((attempt: number) => {
    if (attempt !== attemptRef.current) return;
    publish({ status: "completed", hint: "Resumo concluído.", transcript: transcriptRef.current });
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") {
      release();
      return;
    }
    // Do not close the peer on a guessed timeout. Realtime confirms final
    // session drainage with session.closed, preserving the end of the audio.
    try {
      channel.send(JSON.stringify({ type: "session.close" }));
      finishTimerRef.current = window.setTimeout(() => {
        if (attempt === attemptRef.current) release();
      }, 15_000);
    } catch {
      release();
    }
  }, [publish, release]);

  const play = useCallback((summary: string) => {
    const source = summary.replace(/\s+/g, " ").trim().slice(0, 1_200);
    if (!enabled || !source) return;
    // A browser can reject the first asynchronous play call even though the
    // buyer clicked the action. Reuse the already-authorized media track on
    // the next tap rather than silently ignoring it or creating another call.
    if (peerRef.current) {
      if (finishTimerRef.current === null) {
        resumeAudio(attemptRef.current);
        return;
      }
      // The previous response is already complete and only waiting for the
      // provider's close acknowledgement. A deliberate replay starts fresh
      // instead of attempting to play an exhausted remote track.
      release();
    }
    const attempt = ++attemptRef.current;
    transcriptRef.current = "";
    void (async () => {
      if (!window.RTCPeerConnection) {
        publish({ status: "error", hint: "Este navegador não suporta o resumo em áudio.", transcript: "" });
        return;
      }
      publish({ status: "connecting", hint: "Preparando o resumo em áudio...", transcript: "" });
      try {
        const secret = await createSessionRef.current(source);
        if (attempt !== attemptRef.current) return;
        if (!secret.value) throw new Error("narration_session_missing");

        const peer = new RTCPeerConnection();
        peerRef.current = peer;
        // The summary has no buyer input. recvonly makes this explicit and,
        // unlike checkout voice, never calls getUserMedia or adds a mic track.
        peer.addTransceiver("audio", { direction: "recvonly" });
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "");
        audio.setAttribute("data-zyon-realtime-narration-audio", "true");
        audio.style.display = "none";
        document.body.appendChild(audio);
        audioRef.current = audio;
        peer.ontrack = (event) => {
          if (attempt !== attemptRef.current) return;
          audio.srcObject = event.streams[0] ?? null;
          resumeAudio(attempt, audio);
        };

        const channel = peer.createDataChannel("oai-events");
        channelRef.current = channel;
        channel.addEventListener("message", (message) => {
          if (attempt !== attemptRef.current) return;
          try {
            const event = JSON.parse(message.data) as RealtimeEvent;
            if (event.type === "session.closed") {
              release();
              return;
            }
            if (event.type === "response.output_audio_transcript.delta" && event.delta) {
              transcriptRef.current += event.delta;
              publish({ status: "playing", hint: "Reproduzindo o resumo...", transcript: transcriptRef.current });
            }
            if (event.type === "response.output_audio_transcript.done" && event.transcript) {
              transcriptRef.current = event.transcript;
              publish({ status: "playing", hint: "Reproduzindo o resumo...", transcript: transcriptRef.current });
            }
            if (event.type === "response.done" || event.type === "response.completed") {
              const finalTranscript = transcriptFromResponse(event);
              if (finalTranscript) transcriptRef.current = finalTranscript;
              if (event.response?.status && event.response.status !== "completed") {
                release();
                publish({ status: "error", hint: "Não consegui concluir o resumo agora. Tente novamente.", transcript: transcriptRef.current });
                return;
              }
              completeSession(attempt);
            }
          } catch { /* Ignore provider events outside the narration contract. */ }
        });
        channel.addEventListener("open", () => {
          if (attempt !== attemptRef.current) return;
          setConnecting(false);
          channel.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "message", role: "user", content: [{ type: "input_text", text: "Reproduza agora o resumo configurado para este produto." }] },
          }));
          channel.send(JSON.stringify({ type: "response.create" }));
        });
        channel.addEventListener("close", () => {
          if (peerRef.current !== peer) return;
          release();
        });
        peer.addEventListener("connectionstatechange", () => {
          if (!["failed", "closed", "disconnected"].includes(peer.connectionState) || peerRef.current !== peer) return;
          release();
          publish({ status: "error", hint: "A conexão do resumo foi interrompida. Tente novamente.", transcript: transcriptRef.current });
        });

        const offer = await peer.createOffer();
        if (attempt !== attemptRef.current) return;
        await peer.setLocalDescription(offer);
        await waitForIceGathering(peer);
        if (attempt !== attemptRef.current) return;
        const response = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: { Authorization: `Bearer ${secret.value}`, "Content-Type": "application/sdp" },
          body: peer.localDescription?.sdp ?? offer.sdp,
        });
        if (!response.ok) {
          const error = new Error("narration_connection_failed") as VoiceError;
          error.status = response.status;
          throw error;
        }
        const answer = await response.text();
        if (attempt !== attemptRef.current) return;
        await peer.setRemoteDescription({ type: "answer", sdp: answer });
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        release();
        publish({ status: "error", hint: narrationErrorHint(error), transcript: transcriptRef.current });
      } finally {
        if (attempt === attemptRef.current) setConnecting(false);
      }
    })();
  }, [completeSession, enabled, publish, release, resumeAudio]);

  useEffect(() => { if (!enabled) stop(); }, [enabled, stop]);
  useEffect(() => () => stop(), [stop]);

  return { connecting, speaking, hint, play, stop };
}

function narrationErrorHint(error: unknown): string {
  const status = Number((error as { status?: unknown })?.status);
  if (status === 401) return "Sua sessão expirou. Atualize a página e tente ouvir novamente.";
  if (status === 403) return "O resumo em áudio não está disponível nesta sessão.";
  if (status === 429) return "O resumo em áudio está temporariamente ocupado. Tente em instantes.";
  if (status >= 500) return "O resumo em áudio está indisponível agora. Tente novamente em instantes.";
  return "Não consegui reproduzir o resumo agora. Tente novamente.";
}

function transcriptFromResponse(event: RealtimeEvent): string {
  return event.response?.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.transcript ?? content.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 1_500);
    function done() { window.clearTimeout(timeout); peer.removeEventListener("icegatheringstatechange", onChange); resolve(); }
    function onChange() { if (peer.iceGatheringState === "complete") done(); }
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}
