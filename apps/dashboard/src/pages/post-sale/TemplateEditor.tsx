import React, { useEffect, useId, useRef, useState } from "react";
import { Sparkles, Save, RefreshCw } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { usePostSaleTemplates, TEMPLATE_TYPES, type TemplateChannel } from "./usePostSaleTemplates.js";

const statuses: Record<string, string> = { approved: "Aprovado", submitted: "Em análise pela Meta", submitting: "Enviando para análise",
  rejected: "Rejeitado", paused: "Pausado pela Meta", disabled: "Indisponível", draft: "Aguardando envio para análise",
  waiting_connection: "Aguardando conexão", submission_unknown: "Confirmando recebimento pela Meta" };

export function TemplateEditor(props: { me: MerchantProfile | null }) {
  const tpl = usePostSaleTemplates(props);
  const id = useId();
  const [type, setType] = useState(TEMPLATE_TYPES[0].type);
  const [channel, setChannel] = useState<TemplateChannel>("whatsapp");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [revision, setRevision] = useState<number>();
  const [dirty, setDirty] = useState(false);
  const [tone, setTone] = useState("profissional");
  const selected = useRef("");
  const key = `${type}:${channel}`;
  const stored = tpl.get(type, channel);
  const busy = !!tpl.savingKey || !!tpl.generatingKey;
  const conflict = dirty && revision !== stored?.metaRevision;
  const label = TEMPLATE_TYPES.find(t => t.type === type)?.label ?? type;

  useEffect(() => {
    if (selected.current === key && dirty) return;
    selected.current = key;
    setBody(stored?.body ?? "");
    setSubject(stored?.subject ?? "");
    setRevision(stored?.metaRevision);
    setDirty(false);
  }, [key, stored, dirty]);

  async function save() {
    if (conflict || !body.trim()) return;
    if (await tpl.save(type, channel, { name: label, body, subject: channel === "email" ? subject : undefined, revision })) setDirty(false);
  }
  async function generate() {
    const result = await tpl.generate(type, channel, { tone });
    if (result) { setBody(result.body); if (result.subject) setSubject(result.subject); setDirty(true); }
  }

  return <section style={{ marginTop: 32 }} aria-label="Templates de pós-venda" aria-busy={busy || tpl.loading}>
    <SectionHeader title="Mensagens de pós-venda" subtitle="Personalize cada cenário. As mensagens de WhatsApp são enviadas somente após aprovação da Meta." variant="secondary" />
    {tpl.loading && <p role="status">Carregando mensagens…</p>}
    <div style={row}>
      <div style={field}><label htmlFor={id + "-type"}>Cenário</label>
        <select id={id + "-type"} style={input} value={type} disabled={busy || dirty} onChange={e => setType(e.target.value)}>
          {TEMPLATE_TYPES.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
      </div>
      <div style={field}><label htmlFor={id + "-channel"}>Canal</label>
        <select id={id + "-channel"} style={input} value={channel} disabled={busy || dirty} onChange={e => setChannel(e.target.value as TemplateChannel)}>
          <option value="whatsapp">WhatsApp</option><option value="email">E-mail</option>
        </select>
      </div>
      <div style={field}><label htmlFor={id + "-tone"}>Tom da sugestão</label>
        <select id={id + "-tone"} style={input} value={tone} disabled={busy} onChange={e => setTone(e.target.value)}>
          <option value="profissional">Profissional</option><option value="amigavel">Amigável</option><option value="descontraido">Descontraído</option>
        </select>
      </div>
    </div>
    {channel === "email" && <div style={{ ...field, marginTop: 16 }}><label htmlFor={id + "-subject"}>Assunto</label>
      <input id={id + "-subject"} style={input} maxLength={150} value={subject} disabled={busy} onChange={e => { setSubject(e.target.value); setDirty(true); }} />
    </div>}
    <div style={{ ...field, marginTop: 16 }}><label htmlFor={id + "-body"}>Mensagem</label>
      <textarea id={id + "-body"} style={{ ...input, width: "100%", resize: "vertical" }} rows={9}
        maxLength={channel === "whatsapp" ? 1024 : 10000} value={body} disabled={busy || !stored}
        onChange={e => { setBody(e.target.value); setDirty(true); }} aria-describedby={id + "-variables"} />
    </div>
    <p id={id + "-variables"} style={help}>Use <code>{"{{buyerName}}"}</code> para o comprador, <code>{"{{storeName}}"}</code> para a loja e <code>{"{{link}}"}</code> para o link.
      {type !== "cart_recovery" && <> Também disponíveis: <code>{"{{productName}}"}</code>, <code>{"{{orderId}}"}</code>, <code>{"{{trackingCode}}"}</code> e <code>{"{{couponBlock}}"}</code>.</>}
    </p>
    {channel === "whatsapp" && <div style={{ marginTop: 20 }}>
      <p role="status"><strong>{statuses[stored?.metaStatus ?? "draft"] ?? "Estado indisponível"}</strong> · Versão {stored?.metaRevision ?? 1}</p>
      <p style={help}>Salvar uma alteração cria uma nova versão para análise. Enquanto ela não estiver aprovada, o envio pode usar o e-mail autorizado do comprador.</p>
      {stored?.metaRejectionReason && <p role="alert">Motivo informado: {stored.metaRejectionReason}</p>}
      <Button variant="outline" disabled={busy} onClick={() => { void tpl.refreshMetaStatus(type, channel); }}><RefreshCw size={14} aria-hidden="true" /> Atualizar status</Button>
      {!!stored?.metaApprovedVersions?.length && <details style={{ marginTop: 16 }}>
        <summary>Versões aprovadas anteriores</summary>
        <p style={help}>A restauração consulta a Meta novamente. Uma versão rejeitada, pausada ou de outra conta não pode ser reativada.</p>
        {stored.metaApprovedVersions.map(version => <div key={version.revision} style={{ marginTop: 16 }}>
          <strong>Versão {version.revision}</strong>
          <p style={{ ...help, whiteSpace: "pre-wrap" }}>{version.body}</p>
          <Button variant="outline" disabled={busy || dirty || !stored.metaRevision} onClick={() => { void tpl.restore(type, version.revision, stored.metaRevision!); }}>Restaurar versão {version.revision}</Button>
        </div>)}
      </details>}
    </div>}
    {conflict && <p role="alert">Uma nova versão foi salva. Seu rascunho foi preservado. Copie o texto antes de carregar a versão atual.</p>}
    {dirty && <p style={help}>Salve ou descarte as alterações antes de trocar de cenário ou canal.</p>}
    <div style={row}>
      <Button variant="primary" disabled={busy || !dirty || conflict || !body.trim() || (channel === "email" && !subject.trim())} onClick={() => { void save(); }}>
        <Save size={15} aria-hidden="true" /> {tpl.savingKey ? "Salvando…" : channel === "whatsapp" ? "Salvar nova versão para análise" : "Salvar e-mail"}
      </Button>
      <Button variant="outline" disabled={busy || dirty || !stored} onClick={() => { void generate(); }}><Sparkles size={15} aria-hidden="true" /> {tpl.generatingKey ? "Gerando…" : "Gerar sugestão com IA"}</Button>
      {dirty && <Button variant="ghost" disabled={busy} onClick={() => setDirty(false)}>Descartar alterações</Button>}
    </div>
  </section>;
}
const row: React.CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 };
const field: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, font: "600 13px var(--font-sans)", color: "var(--color-text)" };
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", font: "14px var(--font-sans)", boxSizing: "border-box", maxWidth: "100%" };
const help: React.CSSProperties = { font: "13px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.6, maxWidth: "72ch", overflowWrap: "anywhere" };
