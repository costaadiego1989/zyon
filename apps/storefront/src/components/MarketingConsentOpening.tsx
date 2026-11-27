"use client";

import styles from "./MarketingConsentOpening.module.css";

export function MarketingConsentOpening({
  storeName,
  onChoice,
}: {
  storeName: string;
  onChoice: (choice: "granted" | "declined") => void;
}) {
  return (
    <section
      className={styles.opening}
      aria-labelledby="marketing-opening-title"
    >
      <div className={styles.content}>
        <h2 id="marketing-opening-title">Antes de começar</h2>
        <p className={styles.question}>
          Quer receber novidades e ofertas de {storeName} pelo WhatsApp?
        </p>
        <p>
          É opcional. Seu atendimento continua em qualquer opção e você pode
          pedir para sair quando quiser.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            data-neu="control"
            onClick={() => onChoice("granted")}
          >
            Quero receber
          </button>
          <button
            type="button"
            data-neu="control"
            onClick={() => onChoice("declined")}
          >
            Agora não
          </button>
        </div>
      </div>
    </section>
  );
}
