"use client";

import { useCallback } from "react";
import { FiVolume2 } from "react-icons/fi";
import styles from "./RichProductContent.module.css";

/** Product audio has its own output-only Realtime narration session. */
export default function ProductNarration({ summary, enabled, placement = "body" }: {
  summary: string;
  enabled: boolean;
  placement?: "body" | "header";
}) {
  const requestNarration = useCallback(() => {
    if (!enabled) return;
    window.dispatchEvent(new CustomEvent("zyon:realtime-product-summary", { detail: { summary } }));
  }, [enabled, summary]);

  return <aside className={`${styles.narration} ${placement === "header" ? styles.narrationInHeader : ""}`} aria-label="Resumo do produto">
    <div className={styles.narrationHeader}>
      <details><summary data-neu="text">{placement === "header" ? "Resumo" : "Resumo do produto"}</summary><p>{summary}</p></details>
      <button data-neu="control" type="button" onClick={requestNarration} aria-label="Ouvir resumo do produto" disabled={!enabled}>
        <FiVolume2 aria-hidden="true" />
        <span>Ouvir resumo</span>
      </button>
    </div>
  </aside>;
}
