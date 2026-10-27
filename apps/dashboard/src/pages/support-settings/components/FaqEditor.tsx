import React from "react";
import { Trash2 } from "lucide-react";
import { FormField, FormTextarea } from "../../../components/FormField.js";
import { Button } from "../../../components/Button.js";
import type { SupportFaqItem } from "@zyon/shared-types";
interface Props { index: number; item: SupportFaqItem; disabled: boolean; onUpdate: (field: "question" | "answer", value: string) => void; onRemove: () => void; }
export function FaqEditor({ index, item, disabled, onUpdate, onRemove }: Props) {
  return <fieldset className="support-faq__item" disabled={disabled}>
    <legend>Pergunta {index + 1}</legend>
    <FormField label="Pergunta do comprador" value={item.question} maxLength={200} disabled={disabled} placeholder="Ex.: Como acompanho meu pedido?" onChange={value => onUpdate("question", value)} />
    <FormTextarea label="Resposta" value={item.answer} maxLength={1000} rows={4} disabled={disabled} hint={item.answer.length + " de 1.000 caracteres"} placeholder="Explique o que o comprador deve fazer, com informações válidas para sua loja." onChange={value => onUpdate("answer", value)} />
    <Button variant="ghost" size="sm" disabled={disabled} onClick={onRemove} aria-label={"Remover pergunta " + (index + 1)}><Trash2 size={15} /> Remover pergunta</Button>
  </fieldset>;
}
