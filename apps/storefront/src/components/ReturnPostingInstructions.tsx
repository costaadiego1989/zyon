import type { SupportCaseDetail } from "@/lib/services/support-case.service";
import styles from "./SupportFlow.module.css";

export function ReturnPostingInstructions({ shipping }: { shipping: SupportCaseDetail["returnShipping"] }) {
  if (!shipping?.authorized) return null;
  if (shipping.awaitingCode) return <p className={styles.system} role="status">A loja aceitou a devolução. Aguarde o código e as instruções nesta conversa antes de enviar o pacote.</p>;
  if (!shipping.postingCode) return null;
  return <section className={styles.stack} aria-label="Instruções de devolução">
    <strong>Código de devolução</strong>
    <p style={{ overflowWrap: "anywhere" }}>{shipping.postingCode}</p>
    {shipping.expiresAt && <p>Validade: {new Date(shipping.expiresAt).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</p>}
    {shipping.carrier === "Correios" && <p>Leve o pacote a uma agência dos Correios e informe o código. Leve também a declaração de conteúdo impressa.</p>}
    {shipping.labelUrl && <a className={styles.button} href={shipping.labelUrl} target="_blank" rel="noopener noreferrer">Abrir etiqueta de devolução</a>}
    {shipping.declarations.map(doc => doc.url ? <a className={styles.button} key={doc.originMerchantId} href={doc.url} target="_blank" rel="noopener noreferrer">Baixar declaração de conteúdo — {doc.originName}</a> : <p className={styles.muted} role="status" key={doc.originMerchantId}>A declaração de {doc.originName} está em preparação. Aguarde o documento antes de postar.</p>)}
  </section>;
}
