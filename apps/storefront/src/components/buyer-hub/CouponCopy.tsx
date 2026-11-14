"use client";

import { useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import styles from "./LoyaltyBenefits.module.css";

export default function CouponCopy({ code, applied = false }: { code: string; applied?: boolean }) {
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setFeedback("copied");
    } catch {
      setFeedback("failed");
    }
  }
  return <div>
    <div className={styles.coupon}>
      <div className={styles.couponLabel}>
        <span>{applied ? "Cupom aplicado automaticamente:" : "Código do cupom"}</span>
        <code className={styles.couponCode}>{code}</code>
      </div>
      <button type="button" className={styles.action} data-neu="control" onClick={copy} aria-label={`Copiar cupom ${code}`}>
        {feedback === "copied" ? <FiCheck aria-hidden="true" size={14} /> : <FiCopy aria-hidden="true" size={14} />}
        {feedback === "copied" ? "Copiado" : "Copiar"}
      </button>
    </div>
    <p className={styles.copyFeedback} role="status">{feedback === "copied" ? "Código copiado." : feedback === "failed" ? "Não foi possível copiar. Selecione o código acima para copiá-lo." : null}</p>
  </div>;
}
