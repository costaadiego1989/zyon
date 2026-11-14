"use client";

import styles from "./CashbackNavigation.module.css";

export function CashbackNavigation({ enabled, pending = false, onOpen }: {
  enabled: boolean; pending?: boolean; onOpen: () => void;
}) {
  if (enabled !== true) return null;
  return <button type="button" data-neu="control" className={styles.button} onClick={onOpen}
    disabled={pending} aria-label="Consultar cashback" aria-busy={pending}>
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" />
      <path d="M20 12h-5v4h5M16.5 14h.01" />
    </svg>
    <span>Cashback</span>
  </button>;
}
