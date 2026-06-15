import { Check, Edit3, RotateCcw, ShieldCheck } from "lucide-react";
import type { PendingVoiceTurn } from "../../hooks/use-voice-checkout.js";

function riskLabel(risk: PendingVoiceTurn["riskLevel"]): string {
  if (risk === "high") return "Confirmação obrigatória";
  if (risk === "medium") return "Revisar antes de enviar";
  return "Baixo risco";
}

export function VoiceConfirmationPanel({
  pendingTurn,
  busy,
  onConfirm,
  onRetry,
  onEditInChat,
}: {
  pendingTurn: PendingVoiceTurn;
  busy: boolean;
  onConfirm: () => void;
  onRetry: () => void;
  onEditInChat: () => void;
}) {
  return (
    <section
      className="aacp-voice-confirmation"
      data-risk={pendingTurn.riskLevel}
      aria-label="Confirmar resposta por voz"
    >
      <div className="aacp-voice-confirmation__header">
        <span className="aacp-voice-confirmation__icon" aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <div>
          <p className="aacp-voice-confirmation__eyebrow">{riskLabel(pendingTurn.riskLevel)}</p>
          <h2>Antes de enviar</h2>
        </div>
      </div>

      <dl className="aacp-voice-confirmation__review">
        <div>
          <dt>Você disse</dt>
          <dd>{pendingTurn.displayTranscript}</dd>
        </div>
        <div>
          <dt>Vou fazer</dt>
          <dd>{pendingTurn.interpretedAction}</dd>
        </div>
      </dl>

      <div className="aacp-voice-confirmation__actions">
        <button
          type="button"
          className="aacp-voice-confirmation__primary"
          onClick={onConfirm}
          disabled={busy}
        >
          <Check size={16} />
          Confirmar e enviar
        </button>
        <button
          type="button"
          className="aacp-voice-confirmation__secondary"
          onClick={onRetry}
          disabled={busy}
        >
          <RotateCcw size={15} />
          Falar de novo
        </button>
        <button
          type="button"
          className="aacp-voice-confirmation__quiet"
          onClick={onEditInChat}
          disabled={busy}
        >
          <Edit3 size={15} />
          Editar no chat
        </button>
      </div>
    </section>
  );
}
