import "../../components/configuration-form.css";
import React, { useEffect, useState } from "react";
import { Plug, Unplug, ExternalLink, AlertCircle, RefreshCw } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Modal } from "../../components/Modal.js";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
import { TabBar } from "../../components/TabBar.js";
import { useIntegrationsPage, type CrmConnectionDTO } from "./useIntegrationsPage.js";
import { CrmLeadsTab } from "./tabs/CrmLeadsTab.js";
import "./crm-integrations.css";

export interface IntegrationsPageProps { apiBaseUrl: string; me: MerchantProfile | null; }
interface ProviderMeta {
  provider: string; name: string; category: "crm" | "marketing"; description: string;
  tokenLabel: string; generateUrl: string; instructions: string; accountRequirement: string;
  authMethod?: "oauth";
  fields?: Array<{ key: string; label: string; placeholder: string; hint: string }>;
}
const PROVIDERS: ProviderMeta[] = [
  { provider: "hubspot", name: "HubSpot", category: "crm",
    description: "Centralize contatos e acompanhe os negócios gerados pelas vendas.",
    authMethod: "oauth", tokenLabel: "", generateUrl: "https://app.hubspot.com/",
    accountRequirement: "Use a conta HubSpot da sua empresa. Contatos e negócios estão disponíveis no plano gratuito, dentro dos limites do provedor.",
    instructions: "Autorize a Zyon na sua conta HubSpot para ler e atualizar contatos e negócios. Você será redirecionado ao HubSpot e voltará para esta loja ao concluir. Usamos o funil padrão ou o primeiro funil disponível." },
  { provider: "pipedrive", name: "Pipedrive", category: "crm",
    description: "Acompanhe compradores e conversões no seu funil de vendas.",
    tokenLabel: "Token de API", generateUrl: "https://app.pipedrive.com/settings/api",
    accountRequirement: "Use a conta Pipedrive da sua empresa. Após o período de teste, o provedor exige assinatura própria.",
    instructions: "Em Preferências pessoais → API, copie o token de um usuário com acesso a pessoas e negócios." },
  { provider: "rdstation", name: "RD Station CRM", category: "crm",
    description: "Envie contatos e negócios para organizar seu relacionamento com clientes.",
    tokenLabel: "Token de API do RD Station CRM", generateUrl: "https://accounts.rdstation.com/",
    accountRequirement: "A sua conta RD Station CRM precisa ter plano Basic, Pro ou Advanced para acessar a API.",
    instructions: "Copie o token da sua conta do RD Station CRM em Configurações → Integrações. O token do RD Station Marketing pertence a outro produto." },
  { provider: "mailchimp", name: "Mailchimp", category: "marketing",
    description: "Sincronize contatos autorizados no seu público, com tags de lead e cliente.",
    tokenLabel: "Chave de API", generateUrl: "https://admin.mailchimp.com/account/api/",
    accountRequirement: "Use a conta Mailchimp da sua empresa e respeite os limites de contatos do plano escolhido. O provedor oferece plano gratuito.",
    instructions: "Gere uma chave em Conta → Extras → API keys e copie o ID do público nas configurações de Audience. Descadastros existentes são preservados; novos contatos com consentimento entram como inscritos.",
    fields: [{ key: "audienceId", label: "ID do público (Audience ID)", placeholder: "Ex.: a1b2c3d4e5",
      hint: "Audience → Settings → Audience name and defaults. Informe o ID, não o nome do público." }] },
  { provider: "activecampaign", name: "ActiveCampaign", category: "marketing",
    description: "Atualize contatos autorizados para organizar seu relacionamento e suas automações.",
    tokenLabel: "Chave de API", generateUrl: "https://www.activecampaign.com/login",
    accountRequirement: "Use a conta ActiveCampaign da sua empresa. Após o período de teste, o provedor exige assinatura própria.",
    instructions: "Em Configurações → Desenvolvedor, copie a URL e a chave da API. A integração atualiza contatos; listas, inscrições e automações continuam sob seu controle no ActiveCampaign.",
    fields: [{ key: "apiUrl", label: "URL da API da sua conta", placeholder: "https://sua-conta.api-us1.com",
      hint: "Use a URL completa mostrada em Desenvolvedor, com HTTPS. Não informe a URL de uma página do painel." }] },
  { provider: "klaviyo", name: "Klaviyo", category: "marketing",
    description: "Sincronize perfis autorizados com a identificação de lead ou cliente da Zyon.",
    tokenLabel: "Chave privada de API", generateUrl: "https://www.klaviyo.com/settings/account/api-keys",
    accountRequirement: "Use a conta Klaviyo da sua empresa e respeite os limites de perfis do plano escolhido. O provedor oferece plano gratuito.",
    instructions: "Crie uma chave privada com leitura e escrita em Profiles. A chave pública não serve para esta conexão. O envio atualiza perfis, sem alterar inscrições de email ou SMS." },
];
const providerName = (key: string) => PROVIDERS.find(p => p.provider === key)?.name ?? key;

export function IntegrationsPage(props: IntegrationsPageProps) {
  const vm = useIntegrationsPage({ me: props.me });
  const [activeTab, setActiveTab] = useState("connections");
  const [provider, setProvider] = useState<ProviderMeta | null>(null);
  const [disconnect, setDisconnect] = useState<CrmConnectionDTO | null>(null);
  const [token, setToken] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [changed, setChanged] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("crm_oauth");
    if (!result) return;
    setOauthMessage(result === "connected" ? "Conta HubSpot conectada à sua loja." :
      result === "denied" ? "A autorização do HubSpot foi cancelada. Sua conexão anterior foi mantida." :
      "Não foi possível concluir a autorização do HubSpot. Tente conectar novamente.");
    url.searchParams.delete("crm_oauth");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);
  const finishClose = () => { setProvider(null); setToken(""); setConfig({}); setChanged(false); setDiscard(false); vm.clearActionError(); };
  const close = () => { if (vm.busy) return; if (token || changed) setDiscard(true); else finishClose(); };
  const open = (meta: ProviderMeta, conn?: CrmConnectionDTO) => {
    vm.clearActionError(); setProvider(meta); setToken(""); setConfig(conn?.config ?? {}); setChanged(false); setDiscard(false);
  };
  const canConnect = provider?.authMethod === "oauth" || (!!token.trim() && (provider?.fields ?? []).every(field => !!config[field.key]?.trim()));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!provider || !canConnect || vm.busy) return;
    if (provider.authMethod === "oauth") { await vm.authorizeHubSpot(); return; }
    const settings = Object.fromEntries((provider.fields ?? []).map(field => [field.key, config[field.key].trim()]));
    if (await vm.connectCrm(provider.provider, { accessToken: token.trim(), config: settings })) finishClose();
  };
  if (!props.me) return <PageHeader title="CRM e marketing" description="Faça login para configurar suas conexões." />;

  return <div className="page-container crm-integrations-page">
    <PageHeader title="CRM e marketing" description="Conecte as contas da sua empresa e acompanhe o envio de contatos e negócios da sua loja."
      actions={<Button variant="outline" onClick={() => void vm.loadData()} disabled={vm.loading || vm.busy}><RefreshCw size={16} /> Atualizar</Button>} />
    <SetupGuide title="Como conectar seus provedores" steps={[
      { title: "Prepare o acesso", description: "Autorize sua conta ou gere a chave indicada pelo provedor. O plano e os limites são os da sua empresa." },
      { title: "Valide a conexão", description: "Informe a chave e os dados da conta. Validamos o acesso antes de salvar." },
      { title: "Confira a sincronização", description: "Veja o resultado de cada envio no histórico. A conexão validada confirma o acesso; o histórico confirma o recebimento dos contatos." },
    ]} />
    <TabBar tabs={[{ key: "connections", label: "Conexões" }, { key: "leads", label: "Histórico de sincronização" }]} activeTab={activeTab} onTabChange={setActiveTab} />
    {oauthMessage && <p className="crm-connection-instructions" role="status">{oauthMessage}</p>}
    {vm.loading ? <PageLoader variant="section" /> : activeTab === "connections" ? (
      vm.connectionsError ? <EmptyState icon={AlertCircle} title="Conexões indisponíveis" description={vm.connectionsError}
        action={<Button onClick={() => void vm.loadData()}>Tentar novamente</Button>} /> : <>
        {(["crm", "marketing"] as const).map(category => <section className="panel" key={category}>
          <SectionHeader title={category === "crm" ? "CRM" : "Marketing"} subtitle={category === "crm" ?
            "Envie contatos e negócios a cada CRM conectado." : "Sincronize apenas contatos com consentimento de marketing por email na sua loja."} />
          <div className="crm-provider-list">
            {PROVIDERS.filter(meta => meta.category === category).map(meta => {
              const conn = vm.crmConnections.find(c => c.provider === meta.provider);
              const connected = conn?.status === "connected";
              return <article className="crm-provider-row" key={meta.provider}>
                <div className="crm-provider-row__content"><h3>{meta.name}</h3><p>{meta.description}</p>
                  {conn?.lastSyncAt && <small>Última sincronização: {new Date(conn.lastSyncAt).toLocaleString("pt-BR")}</small>}
                  {conn && !conn.lastSyncAt && <small>Acesso validado. Aguardando o primeiro envio.</small>}
                </div>
                <span className={`crm-status crm-status--${conn?.status ?? "disconnected"}`}>
                  {connected ? "Conectado" : conn?.status === "error" ? "Precisa de atenção" : "Não conectado"}
                </span>
                <div className="crm-provider-actions">
                  <Button variant={conn ? "outline" : "primary"} disabled={vm.busy} onClick={() => open(meta, conn)}>
                    <Plug size={16} /> {conn ? "Reconfigurar" : "Conectar"}
                  </Button>
                  {conn && <Button variant="outline" disabled={vm.busy} aria-label={`Desconectar ${meta.name}`} onClick={() => {
                    vm.clearActionError(); setDisconnect(conn);
                  }}><Unplug size={16} /></Button>}
                </div>
              </article>;
            })}
          </div>
          {category === "marketing" && <p className="crm-marketing-note">Os envios usam as configurações de cada provedor. Gerencie campanhas e automações no painel de marketing; a Zyon registra os contatos recebidos e os envios ignorados por falta de consentimento.</p>}
        </section>)}
      </>
    ) : vm.logError ? <EmptyState icon={AlertCircle} title="Histórico indisponível" description={vm.logError}
      action={<Button onClick={() => void vm.loadData()}>Tentar novamente</Button>} /> : <CrmLeadsTab syncLog={vm.syncLog} />}
    <Modal isOpen={provider !== null} title={`${vm.crmConnections.some(c => c.provider === provider?.provider) ? "Reconfigurar" : "Conectar"} ${provider?.name ?? "provedor"}`}
      subtitle={provider?.authMethod === "oauth" ? "Autorize o acesso aos contatos e negócios da sua empresa." : "Valide o acesso antes de salvar a conexão."} presentation="center" size="lg" onClose={close}
      footer={discard ? <div className="crm-discard"><p>Os dados informados ainda não foram salvos.</p>
        <Button variant="outline" onClick={() => setDiscard(false)}>Continuar editando</Button>
        <Button variant="danger" onClick={finishClose}>Descartar e fechar</Button></div> : <>
        <Button variant="outline" onClick={close} disabled={vm.busy}>Cancelar</Button>
        <Button form="crm-connection-form" type="submit" disabled={vm.busy || !canConnect}>{vm.busy ? "Aguarde..." : provider?.authMethod === "oauth" ? "Autorizar no HubSpot" : "Validar e conectar"}</Button>
      </>}>
      {provider && <form id="crm-connection-form" className="configuration-form crm-connection-form" onSubmit={submit}>
        <p className="crm-connection-instructions">{provider.accountRequirement}</p>
        <p className="crm-connection-instructions">{provider.instructions}</p>
        {provider.authMethod !== "oauth" && <a href={provider.generateUrl} target="_blank" rel="noreferrer">Abrir {provider.name} <ExternalLink size={14} /></a>}
        {provider.authMethod !== "oauth" && <FormField label={provider.tokenLabel} type="password" value={token} onChange={setToken} disabled={vm.busy}
          placeholder={`Cole a chave do ${provider.name}`} inputProps={{ autoComplete: "new-password", spellCheck: false, required: true }}
          hint="A chave fica oculta e é armazenada com criptografia. Use um acesso dedicado à integração." />}
        {(provider.fields ?? []).map(field => <FormField key={field.key} label={field.label} value={config[field.key] ?? ""}
          onChange={value => { setConfig(previous => ({ ...previous, [field.key]: value })); setChanged(true); }}
          disabled={vm.busy} placeholder={field.placeholder} hint={field.hint}
          inputProps={{ required: true, spellCheck: false, autoComplete: "off" }} />)}
        {vm.actionError && <p className="crm-action-error" role="alert">{vm.actionError}</p>}
      </form>}
    </Modal>
    <Modal isOpen={disconnect !== null} title={`Desconectar ${providerName(disconnect?.provider ?? "")}?`}
      subtitle="Novas sincronizações serão interrompidas. Os contatos já enviados permanecem no provedor."
      presentation="center" size="md" onClose={() => { if (!vm.busy) { setDisconnect(null); vm.clearActionError(); } }}
      footer={<><Button variant="outline" disabled={vm.busy} onClick={() => { setDisconnect(null); vm.clearActionError(); }}>Manter conexão</Button>
        <Button variant="danger" disabled={vm.busy} onClick={async () => { if (disconnect && await vm.disconnectCrm(disconnect.id)) setDisconnect(null); }}>
          {vm.busy ? "Desconectando..." : "Desconectar"}</Button></>}>
      {vm.actionError && <p className="crm-action-error" role="alert">{vm.actionError}</p>}
    </Modal>
  </div>;
}
