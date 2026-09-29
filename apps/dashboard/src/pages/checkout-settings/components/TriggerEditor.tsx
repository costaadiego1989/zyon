import React, { useState } from "react";
import type { CheckoutTriggerName } from "@zyon/shared-types";
import { TRIGGER_LABELS, TRIGGER_HELP } from "../lib/constants.js";
import { Button } from "../../../components/Button.js";
import { Modal } from "../../../components/Modal.js";
import { FormField, FormTextarea } from "../../../components/FormField.js";
import { CouponPicker } from "./CouponPicker.js";

export function TriggerEditor({ trigger, message, cooldownSeconds, couponCode, onSave, onCancel, busy }: {
  trigger: CheckoutTriggerName; message?: string; cooldownSeconds?: number; couponCode?: string;
  onSave: (data: { message: string; cooldownSeconds: number; couponCode: string }) => void;
  onCancel: () => void; busy: boolean;
}) {
  const [draft, setDraft] = useState({ message: message ?? "", cooldownSeconds: String(cooldownSeconds ?? 30), couponCode: couponCode ?? "" });
  const seconds = Number(draft.cooldownSeconds);
  const invalid = !draft.cooldownSeconds || !Number.isInteger(seconds) || seconds < 5 || seconds > 300;
  return <Modal isOpen title={`Configurar sinal: ${TRIGGER_LABELS[trigger]}`} subtitle={TRIGGER_HELP[trigger]} size="md" onClose={() => { if (!busy) onCancel(); }} footer={<>
    <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
    <Button variant="primary" disabled={busy || invalid} onClick={() => onSave({ ...draft, cooldownSeconds: seconds })}>Aplicar ao rascunho</Button>
  </>}>
    <div className="cfg-editor-content">
      <FormTextarea label="Mensagem do agente" hint={`${draft.message.length}/300 caracteres. Texto enviado quando este sinal é acionado.`} rows={4} maxLength={300} disabled={busy} value={draft.message} placeholder="Ex.: Posso ajudar a escolher o melhor frete?" onChange={message => setDraft({ ...draft, message })} />
      <FormField label="Espera antes de agir (segundos)" hint="Defina entre 5 e 300 segundos." error={invalid ? "Informe um número inteiro entre 5 e 300." : undefined} type="number" inputProps={{ min: 5, max: 300, step: 1 }} disabled={busy} value={draft.cooldownSeconds} onChange={cooldownSeconds => setDraft({ ...draft, cooldownSeconds })} />
      <CouponPicker label="Cupom vinculado (opcional)" value={draft.couponCode} onChange={code => setDraft({ ...draft, couponCode: code })} disabled={busy} />
      <p className="cfg-help">Depois de aplicar, use “Salvar configurações” na página de Checkout para publicar as alterações.</p>
    </div>
  </Modal>;
}
