import React, { useEffect, useState } from "react";
import { Copy, Check, Globe, ExternalLink } from "lucide-react";
import { Button } from "../../components/Button.js";
import { PageHeader } from "../../components/PageHeader.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { SetupGuide } from "../../components/SetupGuide.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { PageLoader } from "../../components/PageLoader.js";
import { useDomainsPage } from "./useDomainsPage.js";
import { showToast } from "../../components/Toast.js";

export function CustomDomainPage({ onVerifiedDomainChange }: { onVerifiedDomainChange?: (domain: string | undefined) => void }) {
  const vm = useDomainsPage();
  const { state, setNewDomain, addDomain, verifyDomain, removeDomain } = vm;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; domain: string } | null>(null);
  useEffect(() => {
    const domain = state.domains.find(entry => entry.verified)?.domain?.trim().toLowerCase();
    onVerifiedDomainChange?.(domain || undefined);
  }, [onVerifiedDomainChange, state.domains]);
  const copy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedId(id); showToast("success", "Registro copiado"); }
    catch { showToast("error", "Não foi possível copiar. Selecione e copie o valor manualmente."); }
  };
  return <div className="page-container domain-page">
    <PageHeader title="Domínio" description="Conecte o endereço da sua loja e confira o acesso seguro antes de divulgá-lo." />
    {state.loading ? <PageLoader /> : <>
      {state.error && <div className="ui-notice ui-notice--error" role="alert"><p>{state.error}</p><Button variant="outline" size="sm" onClick={vm.reload}>Tentar novamente</Button></div>}
      <div className="configuration-layout">
        <div className="configuration-sections">
          <section className="configuration-section">
            <SectionHeader title="Adicionar endereço" subtitle="Tenha acesso ao painel da empresa onde seu domínio está registrado." />
            <form onSubmit={event => { event.preventDefault(); if (!state.adding && state.newDomain.trim()) void addDomain(); }}>
              <label className="ui-field-label" htmlFor="store-domain">Domínio da loja</label>
              <div className="domain-page__input-row">
                <input id="store-domain" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="loja.suaempresa.com.br" aria-describedby="store-domain-help" value={state.newDomain} onChange={event => setNewDomain(event.target.value)} disabled={state.adding} />
                <Button type="submit" loading={state.adding} disabled={!state.newDomain.trim()}>Adicionar domínio</Button>
              </div>
              <p id="store-domain-help" className="ui-field-help">Informe apenas o endereço, sem https:// ou caminhos de páginas.</p>
            </form>
          </section>
          {state.domains.length > 0 && <section>
            <SectionHeader title="Seus domínios" />
            <div className="domain-page__list">{state.domains.map(domain => <article key={domain.id} className="domain-entry">
              <header className="domain-entry__header">
                <div><h3><Globe size={17} aria-hidden="true" />{domain.domain}</h3><span className={"ui-status " + (domain.verified ? "ui-status--success" : "ui-status--warning")}>{domain.verified ? "DNS verificado" : "Aguardando apontamento"}</span></div>
                <Button variant="ghost" size="sm" disabled={removing === domain.id} onClick={() => setPendingRemoval({ id: domain.id, domain: domain.domain })}>Remover</Button>
              </header>
              {domain.verified ? <div className="domain-entry__verified">
                <p>{domain.verified_at ? "DNS verificado em " + new Date(domain.verified_at).toLocaleDateString("pt-BR") + ". " : "Apontamento confirmado. "}Abra o endereço e confira se a loja correta carrega com conexão segura.</p>
                <a className="zyn-btn zyn-btn--outline zyn-btn--sm" href={"https://" + domain.domain} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" /> Conferir loja</a>
              </div> : <div className="domain-entry__setup">
                <p>Adicione os registros CNAME e TXT no painel DNS do seu provedor. Os valores abaixo foram recebidos para este domínio.</p>
                <dl className="domain-records">
                  <div><dt>Tipo</dt><dd>CNAME</dd></div>
                  {[{ label: "Nome / host", value: domain.domain, suffix: "host" }, { label: "Valor / destino", value: domain.cname_target, suffix: "target" }].map(record => <div key={record.suffix}><dt>{record.label}</dt><dd><code>{record.value}</code><button type="button" className="ui-icon-button" aria-label={"Copiar " + record.label.toLowerCase()} onClick={() => void copy(record.value, domain.id + record.suffix)}>{copiedId === domain.id + record.suffix ? <Check size={16} /> : <Copy size={16} />}</button></dd></div>)}
                </dl>
                {domain.txt_name && domain.txt_value && <dl className="domain-records">
                  <div><dt>Tipo</dt><dd>TXT — confirmação de propriedade</dd></div>
                  {[{ label: "Nome / host TXT", value: domain.txt_name, suffix: "txt-host" }, { label: "Valor TXT", value: domain.txt_value, suffix: "txt-value" }].map(record => <div key={record.suffix}><dt>{record.label}</dt><dd><code>{record.value}</code><button type="button" className="ui-icon-button" aria-label={"Copiar " + record.label.toLowerCase()} onClick={() => void copy(record.value, domain.id + record.suffix)}>{copiedId === domain.id + record.suffix ? <Check size={16} /> : <Copy size={16} />}</button></dd></div>)}
                </dl>}
                <p className="ui-field-help">Mantenha o TXT para comprovar a propriedade. Use um CNAME visível no DNS; registros com proxy ou CNAME achatado não passam nesta verificação.</p>
                <p className="ui-field-help">O provedor pode pedir o host completo ou apenas a parte anterior ao seu domínio. Se não aceitar CNAME neste endereço, consulte as instruções dele antes de alterar outros registros.</p>
                <div className="configuration-actions"><Button variant="outline" loading={state.verifying === domain.id} onClick={() => void verifyDomain(domain.id)}>Verificar domínio</Button><span className="ui-field-help">A propagação depende do provedor.</span></div>
              </div>}
            </article>)}</div>
          </section>}
        </div>
        <aside className="configuration-aside" aria-label="Orientações sobre domínio">
          <h2>Seu endereço, sua identidade</h2>
          <p>Você pode usar um domínio principal ou um subdomínio, como loja.suaempresa.com.br, conforme os limites do plano.</p>
          <h2>Antes de compartilhar</h2>
          <p>A verificação confirma o DNS. Confira também se a loja abre por HTTPS, com o conteúdo correto e sem aviso de certificado.</p>
        </aside>
      </div>
      <SetupGuide title="Passo a passo para conectar o domínio" defaultOpen={state.domains.length === 0} steps={[
        { title: "Adicione o endereço", description: "Informe o domínio que você possui e deseja usar na loja." },
        { title: "Configure os registros recebidos", description: "Copie o destino CNAME e o desafio TXT exibidos para este domínio e configure os dois no painel do seu provedor." },
        { title: "Verifique e confira a loja", description: "Volte para verificar o apontamento. Depois, abra o endereço por HTTPS e confira a loja antes de divulgá-lo." },
      ]} />
    </>}
    <ConfirmDialog open={Boolean(pendingRemoval)} title="Remover domínio da loja?" description={pendingRemoval ? "O endereço " + pendingRemoval.domain + " deixará de estar associado à loja. Os registros no seu provedor DNS não serão removidos por esta ação." : ""} confirmLabel="Remover domínio" onCancel={() => setPendingRemoval(null)} onConfirm={() => { if (!pendingRemoval) return; const id = pendingRemoval.id; setPendingRemoval(null); setRemoving(id); void removeDomain(id).finally(() => setRemoving(null)); }} />
  </div>;
}
