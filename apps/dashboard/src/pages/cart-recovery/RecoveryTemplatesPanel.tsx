import React, { useId } from "react";
import { CheckCircle2, Mail, MessageCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { TEMPLATE_STATUS_LABELS, validateTemplates } from "./recovery-templates-model.js";
import { useRecoveryTemplates } from "./useRecoveryTemplates.js";

export function RecoveryTemplatesPanel({ apiBaseUrl }: { apiBaseUrl: string }) {
  const vm = useRecoveryTemplates(apiBaseUrl);
  const id = useId();
  const validation = vm.draft ? validateTemplates(vm.draft) : null;
  const whatsappChanged = !!vm.draft && !!vm.saved && vm.draft.whatsapp.body !== vm.saved.whatsapp.body;
  const busy = vm.saving || vm.generating;

  return (
    <section className="panel recovery-templates" aria-label="Mensagens de recuperação" aria-busy={vm.loading || busy}>
      <SectionHeader title="Mensagens de recuperação" subtitle="Personalize o convite para retomar a compra, com a identidade da sua loja." />

      {vm.loading && <div role="status" className="recovery-loading">
        <div className="recovery-loading-line" />
        <div className="recovery-loading-line" />
        Carregando suas mensagens…
      </div>}
      {vm.error && <p role="alert" className="recovery-feedback recovery-feedback--error">{vm.error}</p>}
      {!vm.saved && !vm.loading && <Button variant="outline" onClick={() => { void vm.refresh(); }}>Tentar novamente</Button>}

      {vm.saved && vm.draft && <>
        <div className="recovery-ai-tools">
          <div>
            <h3>Um ponto de partida com IA</h3>
            <p>A IA cria rascunhos seguindo as diretrizes de templates da Meta. Revise antes de salvar: a aprovação final do WhatsApp depende da Meta.</p>
          </div>
          <Button variant="outline" loading={vm.generating} disabled={busy || vm.dirty || vm.conflict} onClick={() => { void vm.generate(); }}>
            <span className="recovery-button-label"><Sparkles size={16} aria-hidden="true" /> Gerar mensagens com IA</span>
          </Button>
        </div>
        {vm.dirty && <p className="recovery-help">Salve ou descarte as alterações antes de gerar outro rascunho.</p>}

        <div className="recovery-channel-status">
          <div role="status" aria-live="polite">
            <strong className="recovery-status-label">
              {vm.saved.effectiveChannel === "whatsapp_template" && <CheckCircle2 size={16} aria-hidden="true" />}
              {TEMPLATE_STATUS_LABELS[vm.saved.whatsapp.status] ?? "Estado do WhatsApp indisponível"}
            </strong>
            <p>{vm.saved.effectiveChannel === "whatsapp_template"
              ? "A recuperação pode usar o WhatsApp com a mensagem aprovada."
              : "A recuperação usa e-mail enquanto o WhatsApp não estiver conectado e aprovado."}</p>
            {vm.saved.whatsapp.rejectionReason && <p className="recovery-rejection">Motivo informado: {vm.saved.whatsapp.rejectionReason}</p>}
          </div>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void vm.refresh(); }}>
            <span className="recovery-button-label"><RefreshCw size={14} aria-hidden="true" /> Atualizar estado</span>
          </Button>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); void vm.save(); }}>
          <div className="recovery-message-editors">
            <fieldset disabled={busy}>
              <legend><Mail size={18} aria-hidden="true" /> E-mail</legend>
              <p className="recovery-channel-description">Disponível após salvar. Não depende de aprovação da Meta.</p>
              <label htmlFor={id + "-subject"} className="field-label">Assunto</label>
              <input id={id + "-subject"} className="field-input" required maxLength={150} value={vm.draft.email.subject}
                onChange={(e) => vm.edit({ ...vm.draft!, email: { ...vm.draft!.email, subject: e.target.value } })} />
              <label htmlFor={id + "-email"} className="field-label">Mensagem de e-mail</label>
              <textarea id={id + "-email"} className="field-input" rows={9} required maxLength={10_000}
                aria-describedby={id + "-variables"} value={vm.draft.email.body}
                onChange={(e) => vm.edit({ ...vm.draft!, email: { ...vm.draft!.email, body: e.target.value } })} />
            </fieldset>
            <fieldset disabled={busy}>
              <legend><MessageCircle size={18} aria-hidden="true" /> WhatsApp</legend>
              <p className="recovery-channel-description">Alterar o texto exige uma nova análise. O envio começa com a conta da loja conectada e o modelo aprovado.</p>
              <label htmlFor={id + "-whatsapp"} className="field-label">Mensagem para aprovação</label>
              <textarea id={id + "-whatsapp"} className="field-input recovery-whatsapp-body" rows={13} required maxLength={1_024}
                aria-describedby={id + "-variables " + id + "-whatsapp-detail"} value={vm.draft.whatsapp.body}
                onChange={(e) => vm.edit({ ...vm.draft!, whatsapp: { ...vm.draft!.whatsapp, body: e.target.value } })} />
              <div id={id + "-whatsapp-detail"} className="recovery-field-meta">
                <span>Português (Brasil) · Marketing · Versão {vm.saved.whatsapp.revision}</span>
                <span>{vm.draft.whatsapp.body.length.toLocaleString("pt-BR")} / 1.024</span>
              </div>
            </fieldset>
          </div>

          <details className="recovery-variables" id={id + "-variables"}>
            <summary>Como personalizar nomes e link do carrinho</summary>
            <p>Use <code>{"{{buyerName}}"}</code> para o comprador, <code>{"{{storeName}}"}</code> para a loja e <code>{"{{link}}"}</code> para o carrinho. Os dados são preenchidos automaticamente ao enviar. Mantenha o link nas duas mensagens.</p>
          </details>
          <p className="recovery-help">O envio respeita os dados e a autorização de contato do comprador. O estado da análise é atualizado automaticamente.</p>

          {vm.conflict && <div role="alert" className="recovery-feedback">
            <p>Há uma versão mais recente salva. Seu rascunho foi preservado. Copie o texto que deseja manter antes de carregar a versão salva.</p>
            <details>
              <summary>Comparar com a versão salva</summary>
              <p><strong>Assunto:</strong> {vm.saved.email.subject}</p>
              <p className="recovery-saved-copy"><strong>E-mail:</strong>{"\n"}{vm.saved.email.body}</p>
              <p className="recovery-saved-copy"><strong>WhatsApp:</strong>{"\n"}{vm.saved.whatsapp.body}</p>
            </details>
          </div>}
          {vm.dirty && validation && <p role="status" className="recovery-feedback">{validation}</p>}
          {vm.notice && <p role="status" className="recovery-feedback">{vm.notice}</p>}
          <div className="recovery-template-actions">
            <Button type="submit" loading={vm.saving} disabled={busy || !vm.dirty || vm.conflict || !!validation}>
              {whatsappChanged && vm.saved.whatsappConnected ? "Salvar e enviar para análise" : "Salvar mensagens"}
            </Button>
            {(vm.dirty || vm.conflict) && <Button variant="ghost" disabled={busy} onClick={vm.discard}>
              {vm.conflict ? "Usar versão salva" : "Descartar alterações"}
            </Button>}
            {vm.saved.suggested && <Button variant="ghost" disabled={busy || vm.dirty || vm.conflict} onClick={() => vm.edit({
              email: { ...vm.saved!.suggested!.email },
              whatsapp: { ...vm.saved!.suggested!.whatsapp, revision: vm.saved!.whatsapp.revision },
            })}>Usar texto padrão</Button>}
          </div>
        </form>
      </>}
    </section>
  );
}
