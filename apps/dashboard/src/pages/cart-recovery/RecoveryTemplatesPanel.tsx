import React, { useId } from "react";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { TEMPLATE_STATUS_LABELS, validateTemplates } from "./recovery-templates-model.js";
import { useRecoveryTemplates } from "./useRecoveryTemplates.js";

export function RecoveryTemplatesPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const vm = useRecoveryTemplates(apiBaseUrl);
  const id = useId();
  const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", font: "14px var(--font-sans)" };
  const paragraphStyle: React.CSSProperties = { color: "var(--color-text-secondary)", font: "13px/1.6 var(--font-sans)", maxWidth: "72ch" };
  const validation = vm.draft ? validateTemplates(vm.draft) : null;
  const whatsappChanged = !!vm.draft && !!vm.saved && vm.draft.whatsapp.body !== vm.saved.whatsapp.body;

  return (
    <section className="panel" style={{ padding: "20px 24px", minWidth: 0 }} aria-label="Mensagens de recuperação" aria-busy={vm.loading}>
      <SectionHeader title="Mensagens de recuperação" subtitle="Edite os textos e acompanhe a aprovação do WhatsApp por aqui." />
      {vm.loading && <div role="status" style={paragraphStyle}>
        <div style={{ background: "var(--color-border)", height: 14, maxWidth: 220, marginBottom: 12, borderRadius: 4 }} />
        Carregando suas mensagens…
      </div>}
      {vm.error && <p role="alert" style={{ ...paragraphStyle, color: "var(--color-error)" }}>{vm.error}</p>}
      {!vm.saved && !vm.loading && <Button variant="outline" onClick={() => { void vm.refresh(); }}>Tentar novamente</Button>}
      {vm.saved && vm.draft && <>
        <div role="status" aria-live="polite" style={{ marginBottom: 24 }}>
          <p style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", margin: "0 0 6px" }}>
            {TEMPLATE_STATUS_LABELS[vm.saved.whatsapp.status] ?? "Estado do WhatsApp indisponível"}
          </p>
          <p style={{ ...paragraphStyle, margin: 0 }}>
            {vm.saved.effectiveChannel === "whatsapp_template"
              ? "WhatsApp disponível para recuperação com o modelo aprovado."
              : "Canal disponível: e-mail. O WhatsApp depende de conexão ativa e aprovação da mensagem."}
            {" "}O envio depende também dos dados e da autorização de contato do comprador.
          </p>
          {vm.saved.whatsapp.rejectionReason && <p style={{ ...paragraphStyle, marginBottom: 0 }}>
            Motivo informado: {vm.saved.whatsapp.rejectionReason}
          </p>}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void vm.save(); }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 28 }}>
            <fieldset disabled={vm.saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", padding: 0 }}>E-mail</legend>
              <p style={paragraphStyle}>Funciona independentemente da aprovação da Meta. As alterações valem após salvar.</p>
              <label htmlFor={`${id}-subject`} className="field-label">Assunto</label>
              <input id={`${id}-subject`} className="field-input" style={fieldStyle} required maxLength={150} value={vm.draft.email.subject}
                onChange={(e) => vm.edit({ ...vm.draft!, email: { ...vm.draft!.email, subject: e.target.value } })} />
              <label htmlFor={`${id}-email`} className="field-label" style={{ display: "block", marginTop: 16 }}>Mensagem de e-mail</label>
              <textarea id={`${id}-email`} className="field-input" style={{ ...fieldStyle, resize: "vertical", minHeight: 150 }} rows={7} required maxLength={10_000}
                aria-describedby={`${id}-variables`} value={vm.draft.email.body}
                onChange={(e) => vm.edit({ ...vm.draft!, email: { ...vm.draft!.email, body: e.target.value } })} />
            </fieldset>
            <fieldset disabled={vm.saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", padding: 0 }}>WhatsApp</legend>
              <p style={paragraphStyle}>Ao alterar e salvar, o texto segue para nova análise. Até a aprovação, a recuperação usa e-mail.</p>
              <label htmlFor={`${id}-whatsapp`} className="field-label">Mensagem para aprovação</label>
              <textarea id={`${id}-whatsapp`} className="field-input" style={{ ...fieldStyle, resize: "vertical", minHeight: 150 }} rows={7} required maxLength={1_024}
                aria-describedby={`${id}-variables ${id}-whatsapp-detail`} value={vm.draft.whatsapp.body}
                onChange={(e) => vm.edit({ ...vm.draft!, whatsapp: { ...vm.draft!.whatsapp, body: e.target.value } })} />
              <p id={`${id}-whatsapp-detail`} style={paragraphStyle}>
                Português (Brasil) · Marketing · Versão {vm.saved.whatsapp.revision}
                {!vm.saved.whatsappConnected && <><br />Conecte o WhatsApp da loja para enviar o modelo à análise.</>}
              </p>
            </fieldset>
          </div>
          <p id={`${id}-variables`} style={paragraphStyle}>
            Use <code>{"{{buyerName}}"}</code> para o comprador, <code>{"{{storeName}}"}</code> para a loja e <code>{"{{link}}"}</code> para o carrinho.
            {" "}Inclua o link nas duas mensagens. As demais palavras são enviadas como você escrever.
          </p>
          {vm.conflict && <div role="alert" style={{ marginBlock: 16 }}>
            <p style={paragraphStyle}>Há uma versão mais recente salva. Seu rascunho foi preservado. Copie o texto que deseja manter antes de carregar a versão salva.</p>
            <details style={paragraphStyle}>
              <summary style={{ cursor: "pointer" }}>Comparar com a versão salva</summary>
              <p><strong>Assunto:</strong> {vm.saved.email.subject}</p>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>E-mail:</strong>{"\n"}{vm.saved.email.body}</p>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>WhatsApp:</strong>{"\n"}{vm.saved.whatsapp.body}</p>
            </details>
          </div>}
          {vm.dirty && validation && <p role="status" style={paragraphStyle}>{validation}</p>}
          {vm.notice && <p role="status" style={paragraphStyle}>{vm.notice}</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 20 }}>
            <Button type="submit" loading={vm.saving} disabled={!vm.dirty || vm.conflict || !!validation}>
              {whatsappChanged ? "Salvar e enviar para análise" : "Salvar mensagens"}
            </Button>
            {(vm.dirty || vm.conflict) && <Button variant="ghost" disabled={vm.saving} onClick={vm.discard}>
              {vm.conflict ? "Usar versão salva" : "Descartar alterações"}
            </Button>}
            <Button variant="ghost" disabled={vm.saving} onClick={() => { void vm.refresh(); }}>Atualizar estado</Button>
            {vm.saved.suggested && <Button variant="ghost" disabled={vm.saving || vm.dirty || vm.conflict} onClick={() => vm.edit({
              email: { ...vm.saved!.suggested!.email },
              whatsapp: { ...vm.saved!.suggested!.whatsapp, revision: vm.saved!.whatsapp.revision },
            })}>Usar textos sugeridos</Button>}
            <span style={paragraphStyle}>Estado atualizado a cada 15 segundos.</span>
          </div>
        </form>
      </>}
    </section>
  );
}
