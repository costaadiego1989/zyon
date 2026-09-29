import React, { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, Save, Send, Sparkles } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { FormField, FormSelect, FormTextarea } from "../../components/FormField.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Modal } from "../../components/Modal.js";
import { TEMPLATE_TYPES, type TemplateChannel, usePostSaleTemplates } from "./usePostSaleTemplates.js";
import { messageStatusLabel } from "./template-status.js";
import "../../components/configuration-form.css";

export function TemplateEditor(props: { me: MerchantProfile | null; initialType?: string; onClose?: () => void }) {
  const tpl = usePostSaleTemplates(props);
  const id = useId();
  const [type, setType] = useState(props.initialType ?? TEMPLATE_TYPES[0].type);
  const [channel, setChannel] = useState<TemplateChannel>("whatsapp");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [revision, setRevision] = useState<number>();
  const [dirty, setDirty] = useState(false);
  const [tone, setTone] = useState("profissional");
  const [closeRequested, setCloseRequested] = useState(false);
  const selected = useRef("");
  const key = `${type}:${channel}`;
  const stored = tpl.get(type, channel);
  const busy = Boolean(tpl.savingKey || tpl.generatingKey || tpl.refreshingKey);
  const conflict = dirty && (revision !== stored?.metaRevision || tpl.conflictKey === key);
  const canSubmit = channel === "whatsapp" && !!stored && ["draft", "rejected", "disabled"].includes(stored.metaStatus ?? "");
  const label = TEMPLATE_TYPES.find(template => template.type === type)?.label ?? type;

  useEffect(() => {
    if (selected.current === key && dirty) return;
    selected.current = key;
    setBody(stored?.body ?? ""); setSubject(stored?.subject ?? "");
    setRevision(stored?.metaRevision); setDirty(false);
  }, [key, stored, dirty]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || tpl.loading || tpl.loadError || conflict || !body.trim() || (channel === "email" && !subject.trim())) return;
    if (await tpl.save(type, channel, { name: label, body, subject: channel === "email" ? subject : undefined, revision })) setDirty(false);
  }
  async function generate() {
    const result = await tpl.generate(type, channel, { tone });
    if (result) { setBody(result.body); if (result.subject) setSubject(result.subject); setDirty(true); }
  }

  function close() {
    if (busy || tpl.loading) return;
    if (dirty) setCloseRequested(true);
    else props.onClose?.();
  }
  const actions = <>
    {closeRequested ? <div className="message-close-confirm" role="alert">
      <p>Há alterações que ainda não foram salvas.</p>
      <div><Button variant="outline" onClick={() => setCloseRequested(false)}>Continuar editando</Button><Button variant="ghost" onClick={props.onClose}>Descartar e fechar</Button></div>
    </div> : <>
      <Button form={id} type="submit" loading={!!tpl.savingKey} disabled={busy || tpl.loading || !!tpl.loadError || !stored || !dirty || conflict || !body.trim() || (channel === "email" && !subject.trim())}>
        <Save size={16} /> {channel === "whatsapp" ? "Salvar mensagem" : "Salvar e-mail"}
      </Button>
      {canSubmit && <Button variant={dirty ? "outline" : "primary"} disabled={busy || tpl.loading || !!tpl.loadError || dirty || conflict} onClick={() => { void tpl.submitMeta(type, channel); }}><Send size={16} /> Enviar para análise</Button>}
      {dirty && <Button variant="ghost" disabled={busy || tpl.loading || (!!tpl.loadError && conflict)} onClick={() => { setDirty(false); tpl.clearFeedback(); }}>{conflict ? "Usar versão salva" : "Descartar alterações"}</Button>}
      {props.onClose && <Button variant="ghost" disabled={busy || tpl.loading} onClick={close}>Fechar</Button>}
    </>}
  </>;
  const editor = <section className={props.onClose ? "post-sale-template-editor post-sale-template-editor--modal" : "panel post-sale-template-editor"} aria-label="Editor de mensagem" aria-busy={busy || tpl.loading}>
    {!props.onClose && <SectionHeader title="Mensagens de pós-venda" subtitle="Escolha o cenário e o canal, revise o texto e salve. Cada combinação tem sua própria mensagem." />}
    {tpl.loading && !stored && <p role="status" className="post-sale-template-editor__meta-copy">Carregando mensagens…</p>}
    {tpl.loadError && <EmptyState title="Mensagens indisponíveis" description={tpl.loadError}
      action={<Button variant="outline" disabled={busy || tpl.loading} onClick={tpl.reload}>Tentar novamente</Button>} />}
    {(!tpl.loading || stored) && <form id={id} onSubmit={save}>
      <fieldset className="configuration-form" disabled={busy || tpl.loading || !!tpl.loadError}>
        {!props.onClose && <div className="configuration-form__grid">
          <FormSelect label="Cenário" value={type} disabled={dirty} onChange={value => { tpl.clearFeedback(); setType(value); }} options={TEMPLATE_TYPES.map(t => ({ value: t.type, label: t.label }))} />
          <FormSelect label="Canal" value={channel} disabled={dirty} onChange={value => { tpl.clearFeedback(); setChannel(value as TemplateChannel); }} options={[{ value: "whatsapp", label: "WhatsApp" }, { value: "email", label: "E-mail" }]} />
        </div>}
        {!stored && !tpl.loadError ? <EmptyState title="Mensagem não disponível" description="Este cenário ainda não retornou uma mensagem. Atualize a lista para tentar novamente."
          action={<Button variant="outline" onClick={tpl.reload}>Atualizar mensagens</Button>} /> : stored && <>
          {channel === "whatsapp" && <div className="post-sale-template-editor__status">
            <div className="post-sale-template-editor__status-heading">
              <p role="status" className="post-sale-template-editor__status-label">{messageStatusLabel(stored.metaStatus)} · Versão {stored.metaRevision ?? 1}</p>
              <Button variant="ghost" size="sm" loading={!!tpl.refreshingKey} onClick={() => { void tpl.refreshMetaStatus(type, channel); }}><RefreshCw size={14} /> Atualizar estado</Button>
            </div>
            <p className="post-sale-template-editor__status-copy">Salve o texto antes de enviá-lo para análise. Uma alteração precisa de nova aprovação da Meta. O envio ao comprador exige conexão ativa e autorização para contato.</p>
            {stored.metaRejectionReason && <p role="alert" className="post-sale-template-editor__feedback post-sale-template-editor__feedback--error">Motivo informado: {stored.metaRejectionReason}</p>}
          </div>}
          {channel === "email" && <FormField label="Assunto do e-mail" value={subject} maxLength={150} onChange={value => { setSubject(value); setDirty(true); }} hint="Até 150 caracteres. Use um assunto que identifique a finalidade do contato." />}
          <FormTextarea label={channel === "email" ? "Mensagem de e-mail" : "Mensagem para aprovação"} rows={9} value={body} maxLength={channel === "whatsapp" ? 1024 : 10000}
            onChange={value => { setBody(value); setDirty(true); }} hint={`${body.length.toLocaleString("pt-BR")} de ${channel === "whatsapp" ? "1.024" : "10.000"} caracteres.`} />
          <details className="message-variables" id={`${id}-variables`}>
            <summary>Como personalizar nomes e links</summary>
            <p>Use <code>{"{{buyerName}}"}</code> para o comprador, <code>{"{{storeName}}"}</code> para a loja e <code>{"{{link}}"}</code> para o link.</p>
            {type !== "cart_recovery" && <p>Também disponíveis: <code>{"{{productName}}"}</code>, <code>{"{{orderId}}"}</code>, <code>{"{{trackingCode}}"}</code> e <code>{"{{couponBlock}}"}</code>.</p>}
          </details>
          <div className="message-ai-tools">
            <FormSelect label="Tom da sugestão com IA" value={tone} disabled={dirty} onChange={setTone} options={[{ value: "profissional", label: "Profissional" }, { value: "amigavel", label: "Amigável" }, { value: "descontraido", label: "Descontraído" }, { value: "promocional", label: "Promocional" }, { value: "luxo", label: "Sofisticado" }]} />
            <Button variant="outline" disabled={dirty || conflict} loading={!!tpl.generatingKey} onClick={() => { void generate(); }}><Sparkles size={16} /> Gerar sugestão com IA</Button>
            <p>A sugestão substitui o texto do editor. Revise antes de salvar.</p>
          </div>
          {channel === "whatsapp" && !!stored.metaApprovedVersions?.length && <details className="message-variables">
            <summary>Restaurar uma versão aprovada</summary>
            <p>A versão precisa continuar aprovada na conta Meta conectada.</p>
            {stored.metaApprovedVersions.map(version => <div className="post-sale-template-editor__version" key={version.revision}>
              <strong>Versão {version.revision}</strong><p className="message-saved-copy">{version.body}</p>
              <div><Button variant="outline" disabled={dirty || conflict || !stored.metaRevision} onClick={() => { void tpl.restore(type, version.revision, stored.metaRevision!); }}>Restaurar versão {version.revision}</Button></div>
            </div>)}
          </details>}
        </>}
      </fieldset>
      {conflict && <div className="post-sale-template-editor__feedback" role="alert">
        <p>Há uma versão mais recente. Seu rascunho foi preservado. Copie o texto que deseja manter antes de usar a versão salva.</p>
        <details><summary>Comparar com a versão salva</summary>{channel === "email" && <p>{stored?.subject}</p>}<p className="message-saved-copy">{stored?.body}</p></details>
      </div>}
      {tpl.actionError && <p className="post-sale-template-editor__feedback post-sale-template-editor__feedback--error" role="alert">{tpl.actionError}</p>}
      {dirty && <p role="status" className="post-sale-template-editor__meta-copy message-draft-note">Salve ou descarte as alterações antes de trocar de cenário ou canal.</p>}
      {stored && !props.onClose && <div className="post-sale-template-editor__actions">{actions}</div>}
    </form>}
  </section>;
  return props.onClose ? <Modal isOpen title={label} subtitle="Revise a mensagem do WhatsApp. Uma alteração salva passa pela análise da Meta." presentation="center" size="lg" onClose={close} footer={actions}>{editor}</Modal> : editor;
}
