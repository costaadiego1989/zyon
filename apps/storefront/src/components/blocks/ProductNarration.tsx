"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { FiVolume2 } from "react-icons/fi";
import styles from "./RichProductContent.module.css";

type NarrationStatus = "idle" | "connecting" | "playing" | "blocked" | "completed" | "error";
type NarrationProgress = { requestId?: unknown; status?: unknown; hint?: unknown; transcript?: unknown };

function copyFor(status: NarrationStatus) {
  if (status === "connecting") return "Preparando áudio";
  if (status === "playing") return "Resumo em reprodução";
  if (status === "blocked") return "Reproduzir resumo";
  if (status === "completed") return "Ouvir novamente";
  if (status === "error") return "Tentar novamente";
  return "Ouvir resumo";
}

/** Product audio has its own output-only Realtime narration session. */
export default function ProductNarration({ summary, enabled, placement = "body" }: {
  summary: string;
  enabled: boolean;
  placement?: "body" | "header";
}) {
  const requestId = useId();
  const [progress, setProgress] = useState<{ status: NarrationStatus; hint: string; transcript: string }>({ status: "idle", hint: "", transcript: "" });
  const busy = progress.status === "connecting" || progress.status === "playing";

  useEffect(() => {
    const updateProgress = (event: Event) => {
      const detail = (event as CustomEvent<NarrationProgress>).detail;
      if (!detail || detail.requestId !== requestId) return;
      const status = detail.status;
      if (status !== "idle" && status !== "connecting" && status !== "playing" && status !== "blocked" && status !== "completed" && status !== "error") return;
      setProgress({
        status,
        hint: typeof detail.hint === "string" ? detail.hint : "",
        transcript: typeof detail.transcript === "string" ? detail.transcript : "",
      });
    };
    window.addEventListener("zyon:realtime-product-narration-progress", updateProgress);
    return () => window.removeEventListener("zyon:realtime-product-narration-progress", updateProgress);
  }, [requestId]);

  const requestNarration = useCallback(() => {
    if (!enabled || busy) return;
    setProgress({ status: "connecting", hint: "Preparando o resumo em áudio...", transcript: "" });
    window.dispatchEvent(new CustomEvent("zyon:realtime-product-summary", { detail: { summary, requestId } }));
  }, [busy, enabled, requestId, summary]);

  const label = copyFor(progress.status);
  const transcript = progress.transcript || summary;

  return <aside className={`${styles.narration} ${placement === "header" ? styles.narrationInHeader : ""}`} aria-label="Resumo do produto">
    <div className={styles.narrationHeader}>
      <details><summary data-neu="text">{placement === "header" ? "Resumo" : "Resumo do produto"}</summary><p data-aacp-product-narration-transcript>{transcript}</p></details>
      <button data-neu="control" type="button" onClick={requestNarration} aria-label={progress.status === "idle" ? "Ouvir resumo do produto" : label} title={progress.hint || label} disabled={!enabled || busy} aria-busy={busy} data-state={progress.status}>
        <FiVolume2 aria-hidden="true" />
        <span>{label}</span>
      </button>
    </div>
    <span className={styles.voiceStatus} role="status" aria-live="polite" aria-atomic="true">{progress.hint}</span>
  </aside>;
}
