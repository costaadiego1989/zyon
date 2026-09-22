"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RealtimeClientSecret = { value: string; expires_at?: number };
type RealtimeEvent = { type?: string; delta?: string };
type VoiceError = Error & { status?: number };

type Options = {
  enabled: boolean;
  createSession: (summary: string) => Promise<RealtimeClientSecret>;
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
export function useRealtimeProductNarration({ enabled, createSession }: Options): RealtimeProductNarrationState {
  const [connecting, setConnecting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [hint, setHint] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const attemptRef = useRef(0);
  const createSessionRef = useRef(createSession);
  createSessionRef.current = createSession;

  const stop = useCallback(() => {
    attemptRef.current += 1;
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
    setConnecting(false);
    setSpeaking(false);
  }, []);

  const play = useCallback((summary: string) => {
    const source = summary.replace(/\s+/g, " ").trim().slice(0, 1_200);
    if (!enabled || !source || peerRef.current || connecting) return;
    const attempt = ++attemptRef.current;
    void (async () => {
      if (!window.RTCPeerConnection) {
        setHint("Este navegador não suporta o resumo em áudio.");
        return;
      }
      setConnecting(true);
      setHint("Preparando o resumo em áudio...");
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
          void audio.play().catch(() => setHint("O navegador bloqueou o áudio. Tente ouvir o resumo novamente."));
        };

        const channel = peer.createDataChannel("oai-events");
        channelRef.current = channel;
        channel.addEventListener("message", (message) => {
          if (attempt !== attemptRef.current) return;
          try {
            const event = JSON.parse(message.data) as RealtimeEvent;
            if (event.type === "response.output_audio_transcript.delta" && event.delta) {
              setSpeaking(true);
              setHint("Reproduzindo o resumo...");
            }
            if (event.type === "response.done" || event.type === "response.completed") {
              setSpeaking(false);
              setHint("Resumo concluído.");
              // The model has finished its bounded narration. Keep a small
              // buffer for final RTP audio, then release this opt-in session.
              window.setTimeout(() => {
                if (attempt === attemptRef.current) stop();
              }, 1_200);
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
        channel.addEventListener("close", () => { if (peerRef.current === peer) stop(); });
        peer.addEventListener("connectionstatechange", () => {
          if (["failed", "closed", "disconnected"].includes(peer.connectionState) && peerRef.current === peer) stop();
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
        stop();
        setHint(narrationErrorHint(error));
      } finally {
        if (attempt === attemptRef.current) setConnecting(false);
      }
    })();
  }, [connecting, enabled, stop]);

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

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 1_500);
    function done() { window.clearTimeout(timeout); peer.removeEventListener("icegatheringstatechange", onChange); resolve(); }
    function onChange() { if (peer.iceGatheringState === "complete") done(); }
    peer.addEventListener("icegatheringstatechange", onChange);
  });
}
