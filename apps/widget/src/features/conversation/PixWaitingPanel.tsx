import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  TimerReset,
} from "lucide-react";
import QRCode from "react-qr-code";
import type { PixWaitingModel } from "../../presentation/models/pix-waiting.model.js";

/**
 * Persistent "aguardando/escutando pagamento" component (ADR §9.2).
 *
 * Lives on the shared shell so it renders identically in chat and voice. While
 * `listening` it communicates that the system is actively waiting on the Asaas
 * webhook — a live pulse, the QR Code + copy-paste code, and a 10-minute
 * countdown. It then transitions to approved / failed / expired.
 *
 * e2e contract: `.zyon-pix-waiting` with
 * `data-pix-state="listening|approved|failed|expired"`.
 */

function remainingLabel(deadline: number, now: number): string {
  const ms = Math.max(0, deadline - now);
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const STATE_COPY: Record<
  PixWaitingModel["status"],
  { kicker: string; title: string; description: string }
> = {
  listening: {
    kicker: "Aguardando pagamento",
    title: "Escutando a confirmação do PIX",
    description:
      "Abra o app do seu banco, leia o QR Code ou cole o código. Confirmo aqui no mesmo instante em que o pagamento cair.",
  },
  approved: {
    kicker: "Pagamento aprovado",
    title: "PIX confirmado",
    description: "Recebemos a confirmação do seu pagamento. Seu pedido está liberado.",
  },
  failed: {
    kicker: "Pagamento não concluído",
    title: "Não recebemos o PIX",
    description: "A cobrança foi recusada ou cancelada. Gere uma nova cobrança para tentar de novo.",
  },
  expired: {
    kicker: "Tempo esgotado",
    title: "A cobrança expirou",
    description: "O prazo do PIX terminou antes da confirmação. Gere uma nova cobrança para continuar.",
  },
};

export function PixWaitingPanel({ model }: { model: PixWaitingModel }) {
  const { status } = model;
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tick the countdown only while actively listening.
  useEffect(() => {
    if (status !== "listening") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  const copy = STATE_COPY[status];
  const isListening = status === "listening";
  const isApproved = status === "approved";
  const isTerminalError = status === "failed" || status === "expired";
  const countdown = remainingLabel(model.deadline, now);

  const handleCopy = () => {
    if (!model.copyPaste) return;
    void navigator.clipboard?.writeText(model.copyPaste);
    setCopied(true);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      className="zyon-pix-waiting"
      data-pix-state={status}
      aria-label="Aguardando confirmação do pagamento PIX"
      aria-live="polite"
    >
      <header className="zyon-pix-waiting__head">
        <span className="zyon-pix-waiting__beacon" aria-hidden="true">
          {isApproved ? (
            <CheckCircle2 size={18} />
          ) : isTerminalError ? (
            <AlertTriangle size={18} />
          ) : (
            <span className="zyon-pix-waiting__beacon-core" />
          )}
        </span>
        <div className="zyon-pix-waiting__headings">
          <span className="zyon-pix-waiting__kicker">{copy.kicker}</span>
          <h3 className="zyon-pix-waiting__title">{copy.title}</h3>
        </div>
        {isListening ? (
          <span className="zyon-pix-waiting__timer" role="timer" aria-label="Tempo restante">
            <TimerReset size={14} aria-hidden="true" />
            <span className="zyon-pix-waiting__timer-value">{countdown}</span>
          </span>
        ) : null}
      </header>

      <p className="zyon-pix-waiting__description">{copy.description}</p>

      {isListening ? (
        <>
          <div className="zyon-pix-waiting__listening" aria-hidden="true">
            <span className="zyon-pix-waiting__wave" />
            <span className="zyon-pix-waiting__wave" />
            <span className="zyon-pix-waiting__wave" />
            <span className="zyon-pix-waiting__listening-label">Escutando o webhook…</span>
          </div>

          {model.copyPaste ? (
            <div className="zyon-pix-waiting__body">
              <div className="zyon-pix-waiting__qr">
                <QRCode value={model.copyPaste} size={148} />
              </div>
              <div className="zyon-pix-waiting__code">
                {model.amountLabel ? (
                  <span className="zyon-pix-waiting__amount">{model.amountLabel}</span>
                ) : null}
                <span className="zyon-pix-waiting__code-label">PIX copia e cola</span>
                <code className="zyon-pix-waiting__code-value">{model.copyPaste}</code>
                <button
                  type="button"
                  className="zyon-pix-waiting__copy"
                  onClick={handleCopy}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Código copiado" : "Copiar código PIX"}
                </button>
              </div>
            </div>
          ) : model.invoiceUrl ? (
            <a
              className="zyon-pix-waiting__invoice"
              href={model.invoiceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir fatura PIX
              <ExternalLink size={14} />
            </a>
          ) : null}
        </>
      ) : null}

      {isTerminalError ? (
        <button type="button" className="zyon-pix-waiting__retry" onClick={model.onDismiss}>
          <TimerReset size={15} />
          Gerar nova cobrança
        </button>
      ) : null}
    </section>
  );
}
