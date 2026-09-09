"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FiVolume2, FiVolumeX } from "react-icons/fi";
import { browserProductVoice, type ProductVoicePlayback, type ProductVoiceProvider } from "@/lib/services/product-narration";
import styles from "./RichProductContent.module.css";

export default function ProductNarration({ summary, enabled, voice = browserProductVoice, placement = "body" }: {
  summary: string;
  enabled: boolean;
  voice?: ProductVoiceProvider;
  placement?: "body" | "header";
}) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<"idle" | "starting" | "speaking">("idle");
  const [blocked, setBlocked] = useState(false);
  const playback = useRef<ProductVoicePlayback | null>(null);
  const stop = useCallback(() => { playback.current?.stop(); playback.current = null; setState("idle"); }, []);
  const start = useCallback(() => {
    if (!enabled || !voice.available()) return;
    stop();
    setBlocked(false);
    setState("starting");
    playback.current = voice.speak(summary, {
      onStart: () => setState("speaking"),
      onEnd: () => setState("idle"),
      onError: () => { setState("idle"); setBlocked(true); },
    });
  }, [enabled, summary, voice, stop]);

  useEffect(() => {
    setAvailable(voice.available());
    // Scheduling lets React's development effect replay cancel the first
    // attempt before it speaks, so opening a product narrates exactly once.
    const timer = enabled && voice.available() ? window.setTimeout(start, 0) : undefined;
    return () => { window.clearTimeout(timer); playback.current?.stop(); playback.current = null; };
  }, [enabled, voice, start]);

  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    window.addEventListener("aacp:product-media-play", stop);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("aacp:product-media-play", stop); document.removeEventListener("visibilitychange", hide); };
  }, [stop]);

  const playing = state !== "idle";
  return <aside className={`${styles.narration} ${placement === "header" ? styles.narrationInHeader : ""}`} aria-label="Resumo do produto">
    <div className={styles.narrationHeader}>
      <details><summary>Resumo do produto</summary><p>{summary}</p></details>
      {available ? <button type="button" onClick={playing ? stop : start} aria-label={playing ? "Parar narração" : "Ouvir resumo"} disabled={!enabled}>
        {playing ? <FiVolumeX aria-hidden="true" /> : <FiVolume2 aria-hidden="true" />}
        {state === "speaking" ? "Parar áudio" : state === "starting" ? "Cancelar áudio" : "Ouvir resumo"}
      </button> : null}
    </div>
    {blocked ? <small className={styles.voiceStatus} role="status">Toque em “Ouvir resumo” para iniciar o áudio.</small> : null}
  </aside>;
}
