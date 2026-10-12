import React, { useId, useRef, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import type { ExperimentForm, Variant } from "../types.js";
import { Button } from "../../../components/Button.js";
import { Modal } from "../../../components/Modal.js";
import { FormField, FormTextarea } from "../../../components/FormField.js";
import "../../../components/configuration-form.css";
import "../experiments.css";

interface ExperimentFormProps {
  form: ExperimentForm;
  errors: Record<string, string>;
  loading: boolean;
  saveError?: string | null;
  onClose: () => void;
  onSave: () => void;
  patch: (p: Partial<ExperimentForm>) => void;
  addVariant: () => void;
  removeVariant: (idx: number) => void;
  updateVariant: (idx: number, updates: Partial<Variant>) => void;
  onGenerateVariants?: () => void | Promise<unknown>;
  generatingVariants?: boolean;
}
export function ExperimentForm({ form, errors, loading, saveError, onClose, onSave, patch, addVariant, removeVariant, updateVariant, onGenerateVariants, generatingVariants }: ExperimentFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const busy = loading || !!generatingVariants;
  function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setSubmitted(true);
    if (Object.keys(errors).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    onSave();
  }
  return <Modal isOpen presentation="center" size="lg" title="Novo teste A/B" subtitle="Compare uma mudança por vez nas instruções do agente."
    onClose={() => { if (!busy) onClose(); }}
    footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button><Button form={id} type="submit" loading={loading} disabled={busy}>Criar teste</Button></>}>
    <form id={id} ref={formRef} onSubmit={submit} noValidate>
      <fieldset className="configuration-form" disabled={busy} aria-busy={busy}>
        {saveError && <p role="alert" className="form-field-error">{saveError}</p>}
        <section className="configuration-form__section">
          <h3>1. Defina o que quer aprender</h3>
          <FormField label="Nome do teste" value={form.name} onChange={name => patch({ name })} maxLength={255} error={submitted ? errors.name : undefined} placeholder="Ex.: Perguntar a preferência antes de recomendar" />
          <FormTextarea label="Objetivo do teste (opcional)" value={form.description ?? ''} onChange={description => patch({ description })} rows={3}
            placeholder="Ex.: Avaliar se perguntar o uso desejado ajuda o cliente a escolher um produto." hint="Descreva a mudança e o resultado que deseja observar." />
          {onGenerateVariants && <><Button variant="outline" onClick={() => void onGenerateVariants()} loading={generatingVariants} disabled={busy || form.name.trim().length < 3}><Sparkles size={16} /> Sugerir nova abordagem com IA</Button>
            <p>A IA preenche a primeira nova abordagem. Revise o texto antes de criar o teste. Uma nova solicitação substitui esse texto.</p></>}
        </section>
        <section className="configuration-form__section">
          <div className="experiment-section-heading"><h3>2. Compare as versões</h3><Button variant="outline" size="sm" onClick={addVariant} disabled={busy || form.variants.length >= 10}><Plus size={16} /> Adicionar versão</Button></div>
          <p>A primeira versão é a referência. Nas demais, descreva a mudança que deseja comparar. Todas continuam sujeitas às regras da loja.</p>
          {submitted && errors.variants && <p role="alert" className="form-field-error">{errors.variants}</p>}
          <div className="experiment-variants-grid">{form.variants.map((variant, index) => {
            const share = Math.floor(100 / form.variants.length) + (index < 100 % form.variants.length ? 1 : 0);
            const label = index === 0 ? "Versão de referência" : "Nova abordagem " + index;
            return <section key={index} className="experiment-variant" aria-label={label}>
              <div className="experiment-section-heading"><h4>{label}</h4><span>{share}% dos participantes</span></div>
              <FormField label={"Nome da versão " + (index + 1)} value={variant.name} onChange={name => updateVariant(index, { name })} error={submitted && !variant.name.trim() ? "Informe um nome para esta versão." : undefined} />
              <FormTextarea label={"Instruções da versão " + (index + 1)} value={variant.description ?? ''} onChange={description => updateVariant(index, { description })} rows={4}
                placeholder={index === 0 ? "Descreva as instruções que o agente deve seguir na referência." : "Ex.: Antes de recomendar, pergunte como o cliente pretende usar o produto."}
                hint="Use instruções concretas. Descontos e condições comerciais devem respeitar a configuração da loja." />
              {index > 0 && form.variants.length > 2 && <Button variant="ghost" onClick={() => removeVariant(index)} aria-label={"Remover versão " + (index + 1)}><Trash2 size={15} /> Remover versão</Button>}
            </section>;
          })}</div>
        </section>
        <section className="configuration-form__section">
          <h3>3. Revise antes de iniciar</h3>
          <p>O público é dividido entre as versões conforme os percentuais acima. Depois de criar, revise o teste e use a ação Iniciar para começar.</p>
          <p>Acompanhe a amostra e a confiança nos resultados. Um número de sessões ou uma diferença inicial, isoladamente, não garante uma conclusão.</p>
        </section>
      </fieldset>
    </form>
  </Modal>;
}
