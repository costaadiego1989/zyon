import React, { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, Save, Sparkles } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { TEMPLATE_TYPES, type TemplateChannel, usePostSaleTemplates } from "./usePostSaleTemplates.js";

const statuses: Record<string, string> = {
  approved: "Aprovado",
  submitted: "Em análise pela Meta",
  submitting: "Enviando para análise",
  rejected: "Rejeitado",
  paused: "Pausado pela Meta",
  disabled: "Indisponível",
  draft: "Aguardando envio para análise",
  waiting_connection: "Aguardando conexão",
  submission_unknown: "Confirmando recebimento pela Meta",
};

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
  const busy = Boolean(tpl.savingKey || tpl.generatingKey);
  const conflict = dirty && revision !== stored?.metaRevision;
  const label = TEMPLATE_TYPES.find((template) => template.type === type)?.label ?? type;

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
    if (
      await tpl.save(type, channel, {
        name: label,
        body,
        subject: channel === "email" ? subject : undefined,
        revision,
      })
    ) {
      setDirty(false);
    }
  }

  async function generate() {
    const result = await tpl.generate(type, channel, { tone });
    if (result) {
      setBody(result.body);
      if (result.subject) setSubject(result.subject);
      setDirty(true);
    }
  }

  return (
    <section
      className="panel post-sale-template-editor"
      aria-label="Mensagens de pós-venda"
      aria-busy={busy || tpl.loading}
    >
      <SectionHeader
        title="Mensagens de pós-venda"
        subtitle="Personalize cada cenário. O WhatsApp só é usado depois que a versão estiver aprovada na conta Meta conectada."
      />

      {tpl.loading ? (
        <p className="post-sale-template-editor__meta-copy" role="status">
          Carregando mensagens…
        </p>
      ) : null}

      <div className="post-sale-template-editor__controls">
        <label className="post-sale-template-editor__field" htmlFor={`${id}-type`}>
          Cenário
          <select
            id={`${id}-type`}
            value={type}
            disabled={busy || dirty}
            onChange={(event) => setType(event.target.value)}
          >
            {TEMPLATE_TYPES.map((template) => (
              <option key={template.type} value={template.type}>
                {template.label}
              </option>
            ))}
          </select>
        </label>

        <label className="post-sale-template-editor__field" htmlFor={`${id}-channel`}>
          Canal
          <select
            id={`${id}-channel`}
            value={channel}
            disabled={busy || dirty}
            onChange={(event) => setChannel(event.target.value as TemplateChannel)}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">E-mail</option>
          </select>
        </label>

        <label className="post-sale-template-editor__field" htmlFor={`${id}-tone`}>
          Tom da sugestão
          <select
            id={`${id}-tone`}
            value={tone}
            disabled={busy}
            onChange={(event) => setTone(event.target.value)}
          >
            <option value="profissional">Profissional</option>
            <option value="amigavel">Amigável</option>
            <option value="descontraido">Descontraído</option>
          </select>
        </label>

        {channel === "email" ? (
          <label
            className="post-sale-template-editor__field post-sale-template-editor__field--full"
            htmlFor={`${id}-subject`}
          >
            Assunto
            <input
              id={`${id}-subject`}
              maxLength={150}
              value={subject}
              disabled={busy}
              onChange={(event) => {
                setSubject(event.target.value);
                setDirty(true);
              }}
            />
          </label>
        ) : null}

        <label
          className="post-sale-template-editor__field post-sale-template-editor__field--full"
          htmlFor={`${id}-body`}
        >
          Mensagem
          <textarea
            id={`${id}-body`}
            rows={9}
            maxLength={channel === "whatsapp" ? 1024 : 10000}
            value={body}
            disabled={busy || !stored}
            onChange={(event) => {
              setBody(event.target.value);
              setDirty(true);
            }}
            aria-describedby={`${id}-variables`}
          />
        </label>
      </div>

      <p className="post-sale-template-editor__variables" id={`${id}-variables`}>
        Use <code>{"{{buyerName}}"}</code> para o comprador, <code>{"{{storeName}}"}</code>{" "}
        para a loja e <code>{"{{link}}"}</code> para o link.
        {type !== "cart_recovery" ? (
          <>
            {" "}
            Também disponíveis: <code>{"{{productName}}"}</code>, <code>{"{{orderId}}"}</code>,{" "}
            <code>{"{{trackingCode}}"}</code> e <code>{"{{couponBlock}}"}</code>.
          </>
        ) : null}
      </p>

      {channel === "whatsapp" ? (
        <div className="post-sale-template-editor__status">
          <p className="post-sale-template-editor__status-label" role="status">
            {statuses[stored?.metaStatus ?? "draft"] ?? "Estado indisponível"} · Versão{" "}
            {stored?.metaRevision ?? 1}
          </p>
          <p className="post-sale-template-editor__status-copy">
            Salvar uma alteração cria uma nova versão para análise. Enquanto ela não estiver
            aprovada, o envio pode usar o e-mail autorizado do comprador.
          </p>
          {stored?.metaRejectionReason ? (
            <p className="post-sale-template-editor__feedback post-sale-template-editor__feedback--error" role="alert">
              Motivo informado: {stored.metaRejectionReason}
            </p>
          ) : null}
          <div className="post-sale-template-editor__status-action">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void tpl.refreshMetaStatus(type, channel);
              }}
            >
              <RefreshCw size={14} aria-hidden="true" /> Atualizar status
            </Button>
          </div>

          {stored?.metaApprovedVersions?.length ? (
            <details className="post-sale-template-editor__versions">
              <summary>Versões aprovadas anteriores</summary>
              <p className="post-sale-template-editor__meta-copy">
                A restauração consulta a Meta novamente. Uma versão rejeitada, pausada ou de
                outra conta não pode ser reativada.
              </p>
              {stored.metaApprovedVersions.map((version) => (
                <div className="post-sale-template-editor__version" key={version.revision}>
                  <strong>Versão {version.revision}</strong>
                  <p className="post-sale-template-editor__meta-copy" style={{ whiteSpace: "pre-wrap" }}>
                    {version.body}
                  </p>
                  <div>
                    <Button
                      variant="outline"
                      disabled={busy || dirty || !stored.metaRevision}
                      onClick={() => {
                        void tpl.restore(type, version.revision, stored.metaRevision!);
                      }}
                    >
                      Restaurar versão {version.revision}
                    </Button>
                  </div>
                </div>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}

      {conflict ? (
        <p className="post-sale-template-editor__feedback post-sale-template-editor__feedback--error" role="alert">
          Uma nova versão foi salva. Seu rascunho foi preservado. Copie o texto antes de carregar
          a versão atual.
        </p>
      ) : null}
      {dirty ? (
        <p className="post-sale-template-editor__feedback">
          Salve ou descarte as alterações antes de trocar de cenário ou canal.
        </p>
      ) : null}

      <div className="post-sale-template-editor__actions">
        <Button
          variant="primary"
          disabled={
            busy ||
            !dirty ||
            conflict ||
            !body.trim() ||
            (channel === "email" && !subject.trim())
          }
          onClick={() => {
            void save();
          }}
        >
          <Save size={15} aria-hidden="true" />{" "}
          {tpl.savingKey
            ? "Salvando…"
            : channel === "whatsapp"
              ? "Salvar nova versão para análise"
              : "Salvar e-mail"}
        </Button>
        <Button
          variant="outline"
          disabled={busy || dirty || !stored}
          onClick={() => {
            void generate();
          }}
        >
          <Sparkles size={15} aria-hidden="true" />{" "}
          {tpl.generatingKey ? "Gerando…" : "Gerar sugestão com IA"}
        </Button>
        {dirty ? (
          <Button variant="ghost" disabled={busy} onClick={() => setDirty(false)}>
            Descartar alterações
          </Button>
        ) : null}
      </div>
    </section>
  );
}
