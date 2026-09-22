"use client";

import { useCallback, useState } from "react";
import { FiVolume2 } from "react-icons/fi";
import styles from "./RichProductContent.module.css";

/** Product audio is delegated to the authenticated Realtime session only. */
export default function ProductNarration({ summary, enabled, placement = "body" }: {
  summary: string;
  enabled: boolean;
  placement?: "body" | "header";
}) {
  const [requested, setRequested] = useState(false);
  const requestNarration = useCallback(() => {
    if (!enabled) return;
    window.dispatchEvent(new CustomEvent("zyon:realtime-product-summary", { detail: { summary } }));
    setRequested(true);
  }, [enabled, summary]);

  return <aside className={`${styles.narration} ${placement === "header" ? styles.narrationInHeader : ""}`} aria-label="Resumo do produto">
    <div className={styles.narrationHeader}>
      <details><summary data-neu="text">{placement === "header" ? "Resumo" : "Resumo do produto"}</summary><p>{summary}</p></details>
      <button data-neu="control" type="button" onClick={requestNarration} aria-label="Ouvir resumo pela compra por voz" disabled={!enabled}>
        <FiVolume2 aria-hidden="true" />
        <span>Ouvir resumo</span>
      </button>
    </div>
    {requested ? <small className={styles.voiceStatus} role="status">Conectando a assistente de voz para tocar o resumo.</small> : null}
  </aside>;
}
