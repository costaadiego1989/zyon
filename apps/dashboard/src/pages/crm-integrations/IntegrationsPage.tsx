import "../../components/configuration-form.css";
import React, { useState } from "react";
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

export interface IntegrationsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}
interface CrmProviderMeta {
  provider: string;
  name: string;
  description: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  generateUrl: string;
}
const CRM_PROVIDERS: CrmProviderMeta[] = [
  {
    provider: "hubspot",
    name: "HubSpot",
    description: "Centralize contatos e acompanhe os negócios gerados pelas vendas.",
    tokenLabel: "Token do aplicativo privado",
    tokenPlaceholder: "Cole o token do HubSpot",
    generateUrl: "https://app.hubspot.com/private-apps",
  },
  {
    provider: "pipedrive",
    name: "Pipedrive",
    description: "Acompanhe compradores e conversões no seu funil de vendas.",
    tokenLabel: "Token de API",
    tokenPlaceholder: "Cole o token do Pipedrive",
    generateUrl: "https://app.pipedrive.com/settings/api",
  },
  {
    provider: "rdstation",
    name: "RD Station CRM",
    description: "Envie contatos e negócios para organizar seu relacionamento com clientes.",
    tokenLabel: "Token de API do RD Station CRM",
    tokenPlaceholder: "Cole o token do RD Station CRM",
    generateUrl: "https://crm.rdstation.com/",
  },
];

export function IntegrationsPage(props: IntegrationsPageProps) {
  const vm = useIntegrationsPage({ me: props.me });
  const [activeTab, setActiveTab] = useState("connections");
  const [provider, setProvider] = useState<CrmProviderMeta | null>(null);
  const [disconnect, setDisconnect] = useState<CrmConnectionDTO | null>(null);
  const [token, setToken] = useState("");
  const [discard, setDiscard] = useState(false);
  const close = () => {
    if (vm.busy) return;
    if (token) {
      setDiscard(true);
      return;
    }
    setProvider(null);
    vm.clearActionError();
  };
  const finishClose = () => {
    setProvider(null);
    setToken("");
    setDiscard(false);
    vm.clearActionError();
  };
  const providerName = (key: string) => CRM_PROVIDERS.find((p) => p.provider === key)?.name ?? key;
  if (!props.me)
    return <PageHeader title="CRM e marketing" description="Faça login para configurar suas conexões." />;

  return (
    <div className="page-container crm-integrations-page">
      <PageHeader
        title="CRM e marketing"
        description="Conecte seu CRM e acompanhe o envio de contatos e negócios."
        actions={
          <Button variant="outline" onClick={() => void vm.loadData()} disabled={vm.loading || vm.busy}>
            <RefreshCw size={16} /> Atualizar
          </Button>
        }
      />
      <SetupGuide
        title="Como conectar seu CRM"
        steps={[
          {
            title: "Prepare o acesso",
            description: "No CRM, gere um token com as permissões necessárias para a integração.",
          },
          {
            title: "Cadastre a conexão",
            description: "Escolha o provedor e informe o token. Confira o estado retornado após salvar.",
          },
          {
            title: "Confira a sincronização",
            description:
              "Acompanhe as tentativas de envio no histórico. Cadastrar a conexão não confirma a chegada de cada contato.",
          },
        ]}
      />
      <TabBar
        tabs={[
          { key: "connections", label: "Conexões" },
          { key: "leads", label: "Histórico de sincronização" },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      {vm.loading ? (
        <PageLoader variant="section" />
      ) : activeTab === "connections" ? (
        <>
          {vm.connectionsError ? (
            <EmptyState
              icon={AlertCircle}
              title="Conexões indisponíveis"
              description={vm.connectionsError}
              action={<Button onClick={() => void vm.loadData()}>Tentar novamente</Button>}
            />
          ) : (
            <section className="panel">
              <SectionHeader
                title="Conectores disponíveis"
                subtitle="Gerencie um acesso por provedor e confira o estado da conexão."
              />
              <div className="crm-provider-list">
                {CRM_PROVIDERS.map((meta) => {
                  const conn = vm.crmConnections.find((c) => c.provider === meta.provider);
                  const connected = conn?.status === "connected";
                  return (
                    <article className="crm-provider-row" key={meta.provider}>
                      <div className="crm-provider-row__content">
                        <h3>{meta.name}</h3>
                        <p>{meta.description}</p>
                        {conn?.lastSyncAt && (
                          <small>
                            Última sincronização: {new Date(conn.lastSyncAt).toLocaleString("pt-BR")}
                          </small>
                        )}
                      </div>
                      <span className={`crm-status crm-status--${conn?.status ?? "disconnected"}`}>
                        {connected
                          ? "Conectado"
                          : conn?.status === "error"
                          ? "Precisa de atenção"
                          : "Não conectado"}
                      </span>
                      <Button
                        variant={connected ? "outline" : "primary"}
                        disabled={vm.busy}
                        onClick={() => {
                          vm.clearActionError();
                          if (connected) setDisconnect(conn!);
                          else {
                            setProvider(meta);
                            setToken("");
                            setDiscard(false);
                          }
                        }}
                      >
                        {connected ? <Unplug size={16} /> : <Plug size={16} />}
                        {connected ? "Desconectar" : conn?.status === "error" ? "Reconfigurar" : "Conectar"}
                      </Button>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          <section className="panel">
            <SectionHeader
              title="Marketing"
              subtitle="Conectores em desenvolvimento, ainda sem sincronização disponível."
            />
            <ul className="crm-upcoming">
              <li>
                <strong>Mailchimp</strong>
                <span>Email marketing e automação</span>
                <span className="crm-status">Em breve</span>
              </li>
              <li>
                <strong>ActiveCampaign</strong>
                <span>Automação e relacionamento</span>
                <span className="crm-status">Em breve</span>
              </li>
              <li>
                <strong>Klaviyo</strong>
                <span>Email e SMS para e-commerce</span>
                <span className="crm-status">Em breve</span>
              </li>
            </ul>
          </section>
        </>
      ) : vm.logError ? (
        <EmptyState
          icon={AlertCircle}
          title="Histórico indisponível"
          description={vm.logError}
          action={<Button onClick={() => void vm.loadData()}>Tentar novamente</Button>}
        />
      ) : (
        <CrmLeadsTab syncLog={vm.syncLog} />
      )}

      <Modal
        isOpen={provider !== null}
        title={`Conectar ${provider?.name ?? "CRM"}`}
        subtitle="Informe o acesso para cadastrar esta conexão."
        presentation="center"
        size="lg"
        onClose={close}
        footer={
          discard ? (
            <div className="crm-discard">
              <p>O token informado ainda não foi salvo.</p>
              <Button variant="outline" onClick={() => setDiscard(false)}>
                Continuar editando
              </Button>
              <Button variant="danger" onClick={finishClose}>
                Descartar e fechar
              </Button>
            </div>
          ) : (
            <>
              <Button variant="outline" onClick={close} disabled={vm.busy}>
                Cancelar
              </Button>
              <Button
                disabled={vm.busy || !token.trim()}
                onClick={async () => {
                  if (provider && (await vm.connectCrm(provider.provider, { accessToken: token.trim() })))
                    finishClose();
                }}
              >
                {vm.busy ? "Conectando..." : "Conectar CRM"}
              </Button>
            </>
          )
        }
      >
        {provider && (
          <div className="configuration-form crm-connection-form">
            <ol>
              <li>Abra as configurações de integração no {provider.name}.</li>
              <li>Gere um token com acesso aos contatos e negócios necessários.</li>
              <li>Cole o token abaixo e confirme a conexão.</li>
            </ol>
            <a href={provider.generateUrl} target="_blank" rel="noreferrer">
              Abrir {provider.name} <ExternalLink size={14} />
            </a>
            <FormField
              label={provider.tokenLabel}
              type="password"
              value={token}
              onChange={setToken}
              disabled={vm.busy}
              placeholder={provider.tokenPlaceholder}
              inputProps={{ autoComplete: "new-password", spellCheck: false }}
              hint="O token fica oculto neste formulário. Use um acesso dedicado à integração."
            />
            {vm.actionError && (
              <p className="crm-action-error" role="alert">
                {vm.actionError}
              </p>
            )}
          </div>
        )}
      </Modal>
      <Modal
        isOpen={disconnect !== null}
        title={`Desconectar ${providerName(disconnect?.provider ?? "")}?`}
        subtitle="Novas sincronizações com este provedor serão interrompidas. Os contatos já enviados permanecem no CRM."
        presentation="center"
        size="md"
        onClose={() => {
          if (!vm.busy) {
            setDisconnect(null);
            vm.clearActionError();
          }
        }}
        footer={
          <>
            <Button
              variant="outline"
              disabled={vm.busy}
              onClick={() => {
                setDisconnect(null);
                vm.clearActionError();
              }}
            >
              Manter conexão
            </Button>
            <Button
              variant="danger"
              disabled={vm.busy}
              onClick={async () => {
                if (disconnect && (await vm.disconnectCrm(disconnect.id))) setDisconnect(null);
              }}
            >
              {vm.busy ? "Desconectando..." : "Desconectar"}
            </Button>
          </>
        }
      >
        {vm.actionError && (
          <p className="crm-action-error" role="alert">
            {vm.actionError}
          </p>
        )}
      </Modal>
    </div>
  );
}
