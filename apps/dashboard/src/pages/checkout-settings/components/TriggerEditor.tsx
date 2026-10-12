import React, { useState } from "react";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { TRIGGER_LABELS, TRIGGER_HELP } from "../lib/constants.js";
import { Button } from "../../../components/Button.js";
import { Modal } from "../../../components/Modal.js";
import { FormTextarea } from "../../../components/FormField.js";
import { CouponPicker } from "./CouponPicker.js";
import { NumberField } from "./NumberField.js";
import { validateIdleSeconds } from "../lib/validation.js";

export function TriggerEditor({ trigger, idleSeconds = 180, message, couponCode, onSave, onCancel, busy }: {
  trigger: CheckoutTriggerName; idleSeconds?: number; message?: string; couponCode?: string;
  onSave: (data: { message?: string; couponCode?: string; idleSeconds?: number }) => void;
  onCancel: () => void; busy: boolean;
}) {
  const [draft, setDraft] = useState({ message: message ?? "", couponCode: couponCode ?? "" });
  const [duration, setDuration] = useState(idleSeconds);
  const isIdle = trigger === "idle_30_seconds";
  const durationError = isIdle ? validateIdleSeconds(duration) : undefined;
  return <Modal isOpen title={`Configurar sinal: ${TRIGGER_LABELS[trigger]}`} subtitle={TRIGGER_HELP[trigger]} size="md" onClose={() => { if (!busy) onCancel(); }} footer={<>
    <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
    <Button variant="primary" disabled={busy || Boolean(durationError)} onClick={() => {
      if (!durationError) onSave({
        ...(draft.message !== (message ?? "") ? { message: draft.message } : {}),
        ...(draft.couponCode !== (couponCode ?? "") ? { couponCode: draft.couponCode } : {}),
        ...(isIdle ? { idleSeconds: duration } : {}),
      });
    }}>Aplicar ao rascunho</Button>
  </>}>
    <div className="cfg-editor-content">
      {isIdle && <NumberField label="Tempo de inatividade" help="Padrão: 180 segundos (3 minutos). Escolha entre 10 e 3.600 segundos sem interação antes de oferecer ajuda." value={duration} min={10} max={3600} suffix="s" disabled={busy} onChange={setDuration} error={durationError} />}
      <FormTextarea label="Mensagem do agente" hint={`${draft.message.length}/300 caracteres. ${trigger === "idle_30_seconds" ? "Deixe vazio para adaptar a ajuda à etapa da compra." : "Texto enviado quando este sinal é acionado."}`} rows={4} maxLength={300} disabled={busy} value={draft.message} placeholder="Ex.: Posso ajudar a escolher o melhor frete?" onChange={message => setDraft({ ...draft, message })} />
      <CouponPicker label="Cupom vinculado (opcional)" value={draft.couponCode} onChange={code => setDraft({ ...draft, couponCode: code })} disabled={busy} />
      <p className="cfg-help">Depois de aplicar, use “Salvar configurações” na página de Checkout para publicar as alterações.</p>
    </div>
  </Modal>;
}
