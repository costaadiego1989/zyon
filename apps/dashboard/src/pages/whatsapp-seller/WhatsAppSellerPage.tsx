import React, { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle,
  ExternalLink,
  FileText,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import type { MerchantProfile } from "../../api-client.js";
import { useWhatsAppSellerPage } from "./useWhatsAppSellerPage.js";
import { WhatsAppTemplatesTab } from "./WhatsAppTemplatesTab.js";
import { PremiumFeatureGate } from "../../components/PremiumFeatureGate.js";
import { TEMPLATE_TYPES, usePostSaleTemplates } from "../post-sale/usePostSaleTemplates.js";
import "./whatsapp-seller.css";

const stateCopy: Record<string, { title: string; text: string }> = {
  provisioning: { title: "Ativando conexão", text: "A Meta está confirmando a ativação do canal. Atualize o estado em instantes." },
  inactive: { title: "Conexão inativa", text: "A conexão com a Meta ainda não está ativa. Atualize o estado ou refaça a conexão oficial." },
  error: { title: "Conexão não concluída", text: "O canal ainda não está disponível. Você pode iniciar uma nova conexão pela Meta." },
};

function formatPhone(number?: string | null) {
  const digits = (number ?? "").replace(/\D/g, "");
  if (!digits) return "Número confirmado pela Meta";
  const national = digits.startsWith("55") ? digits.slice(2) : digits;
  if (national.length === 11) return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `+55 (${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return `+${digits}`;
}

function templateState(approved: number, total: number, loading: boolean) {
  if (loading) return { label: "Consultando", detail: "Verificando o catálogo da loja", tone: "neutral" };
  if (approved === total) return { label: "Prontos", detail: `${approved} templates aprovados`, tone: "success" };
  if (approved > 0) return { label: "Parcial", detail: `${approved} de ${total} aprovados pela Meta`, tone: "pending" };
  return { label: "Pendente", detail: "Templates ainda precisam ser enviados", tone: "pending" };
}

export function WhatsAppSellerPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useWhatsAppSellerPage({ me: props.me });
  const templates = usePostSaleTemplates({ me: props.me });
  const [tab, setTab] = useState<"connection" | "templates">("connection");
  const status = vm.config?.status ?? "disconnected";
  const pending = stateCopy[status];
  const active = status === "active";
  const canStart = vm.config && ["disconnected", "error", "inactive"].includes(status);
  const approvedTemplates = useMemo(() => TEMPLATE_TYPES.filter(({ type }) => templates.get(type, "whatsapp")?.metaStatus === "approved").length, [templates.templates]);
  const approval = templateState(approvedTemplates, TEMPLATE_TYPES.length, templates.loading);

  return (
    <div className="page-container whatsapp-seller">
      <header className="whatsapp-seller__head">
        <div>
          <span className="whatsapp-seller__kicker">Canais da loja <span aria-hidden="true">/</span> WhatsApp</span>
          <h1>WhatsApp Business</h1>
          <p>Atendimento e vendas pela integração oficial da Meta.</p>
        </div>
        {active && <span className="whatsapp-seller__live"><span aria-hidden="true" /> Canal operacional</span>}
      </header>

      {!props.me ? <p>Entre na sua conta para configurar o WhatsApp.</p> : <>
        <TabBar tabs={[{ key: "connection", label: "Canal" }, { key: "templates", label: "Templates" }]}
          activeTab={tab} onTabChange={key => setTab(key as "connection" | "templates")} />

        {tab === "templates" && <PremiumFeatureGate feature="postSale" requiredPlan="Growth" featureLabel="Templates de WhatsApp">
          <WhatsAppTemplatesTab me={props.me} templates={templates} />
        </PremiumFeatureGate>}

        {tab === "connection" && <div className="whatsapp-seller__content">
          {vm.loading && <p role="status" className="whatsapp-seller__loading"><Loader2 size={18} className="spin" /> Carregando canal…</p>}

          {vm.connectError && <div className="whatsapp-seller__error" role="alert">
            <div><strong>Não foi possível concluir esta etapa</strong><p>{vm.connectError}</p></div>
            {vm.connectErrorCode === "2388386" && <a href="https://business.facebook.com/latest/whatsapp_manager/phone_numbers/" target="_blank" rel="noreferrer">Abrir o WhatsApp Manager <ArrowUpRight size={14} /></a>}
            <Button variant="outline" size="sm" disabled={vm.saving || vm.loading} onClick={vm.config ? vm.refresh : vm.load}><RefreshCw size={14} /> Atualizar</Button>
          </div>}

          {!vm.loading && vm.config && <>
            {vm.justConnected && active && <section className="whatsapp-seller__success" aria-live="polite">
              <button className="whatsapp-seller__success-close" aria-label="Fechar confirmação" onClick={vm.dismissConnectionSuccess}><X size={18} /></button>
              <div className="whatsapp-seller__success-mark" aria-hidden="true"><span /><CheckCircle size={42} /></div>
              <span className="whatsapp-seller__success-kicker">Conexão concluída</span>
              <h2>Seu WhatsApp está pronto.</h2>
              <p>O canal oficial foi conectado à sua loja. Agora configure o pagamento na Meta e envie seus templates para começar campanhas e vendas pelo WhatsApp.</p>
              <Button variant="primary" onClick={vm.dismissConnectionSuccess}>Ver configuração do canal</Button>
            </section>}

            {!vm.settings?.configured && <section className="whatsapp-seller__notice" role="status">
              <ShieldCheck size={20} /><div><strong>Conexão oficial em preparação</strong><p>A integração Meta está sendo configurada pela Zyon. Volte a esta tela quando ela estiver disponível.</p></div>
            </section>}

            {active && !vm.justConnected && <section className="whatsapp-seller__console">
              <div className="whatsapp-seller__console-top">
                <div className="whatsapp-seller__channel-id">
                  <div className="whatsapp-seller__channel-icon"><MessageCircle size={25} /></div>
                  <div><span>Canal conectado</span><h2>{formatPhone(vm.config.whatsappNumber)}</h2><p>Meta Cloud API · conta da própria empresa</p></div>
                </div>
                <Button variant={vm.config.enabled ? "outline" : "primary"} disabled={vm.saving} onClick={() => vm.handleToggleEnabled(!vm.config!.enabled)}>
                  {vm.config.enabled ? <Pause size={16} /> : <Play size={16} />}{vm.config.enabled ? "Pausar canal" : "Habilitar canal"}
                </Button>
              </div>

              <div className="whatsapp-seller__readiness" aria-label="Situação da configuração">
                <div className="whatsapp-seller__readiness-row"><span className="whatsapp-seller__readiness-icon whatsapp-seller__readiness-icon--success"><CheckCircle size={17} /></span><div><strong>Atendimento</strong><small>{vm.config.enabled ? "Recebimento de mensagens habilitado" : "Canal pausado pela loja"}</small></div><b className={vm.config.enabled ? "is-success" : ""}>{vm.config.enabled ? "Ativo" : "Pausado"}</b></div>
                <div className="whatsapp-seller__readiness-row"><span className="whatsapp-seller__readiness-icon"><FileText size={17} /></span><div><strong>Templates Meta</strong><small>{approval.detail}</small></div><button type="button" onClick={() => setTab("templates")} className={`whatsapp-seller__status whatsapp-seller__status--${approval.tone}`}>{approval.label}<ArrowUpRight size={13} /></button></div>
                <div className="whatsapp-seller__readiness-row"><span className="whatsapp-seller__readiness-icon"><ShieldCheck size={17} /></span><div><strong>Faturamento da Meta</strong><small>O cartão da empresa é cadastrado e cobrado pela Meta</small></div><a className="whatsapp-seller__status whatsapp-seller__status--action" href="https://business.facebook.com/latest/whatsapp_manager/" target="_blank" rel="noreferrer">Configurar na Meta <ArrowUpRight size={13} /></a></div>
              </div>

              <div className="whatsapp-seller__console-foot">
                <p>Com o canal, faturamento e templates prontos, a loja pode atender clientes e conduzir vendas pelo WhatsApp.</p>
                <div><Button variant="outline" disabled={vm.saving} onClick={vm.refresh}><RefreshCw size={16} /> Atualizar estado</Button><Button variant="ghost" disabled={vm.saving} onClick={vm.handleDisconnect}><Unplug size={16} /> Desconectar</Button></div>
              </div>
            </section>}

            {pending && !active && <section className="whatsapp-seller__notice whatsapp-seller__notice--state" aria-live="polite">
              <RefreshCw size={20} /><div><strong>{pending.title}</strong>{vm.config.whatsappNumber && <h2>{formatPhone(vm.config.whatsappNumber)}</h2>}<p>{pending.text}</p><div className="whatsapp-seller__actions"><Button variant="outline" disabled={vm.saving} onClick={vm.refresh}><RefreshCw size={16} /> Atualizar estado</Button>{status === "provisioning" && <Button variant="ghost" disabled={vm.saving} onClick={vm.handleDisconnect}>Interromper conexão</Button>}</div></div>
            </section>}

            {canStart && vm.settings?.configured && <section className="whatsapp-seller__setup">
              <div className="whatsapp-seller__setup-intro"><span className="whatsapp-seller__kicker">Integração oficial da Meta</span><h2>Conecte a conta da sua empresa.</h2><p>A Zyon nunca usa a conta ou cartão de outra loja. Você escolhe os ativos da própria empresa dentro da Meta.</p></div>
              <ol className="whatsapp-seller__steps">
                <li><span>01</span><div><strong>Conta e número</strong><p>Entre na Meta, escolha ou crie a conta Business e confirme o número da loja.</p></div></li>
                <li><span>02</span><div><strong>Cartão da empresa</strong><p>Cadastre o método de pagamento na Meta. Ele cobre as mensagens cobradas pela Meta, não as vendas da loja.</p></div></li>
                <li><span>03</span><div><strong>Vendas no WhatsApp</strong><p>Envie os templates para aprovação. Com eles ativos, a loja atende, recupera pedidos e vende pelo canal.</p></div></li>
              </ol>
              <div className="whatsapp-seller__setup-action"><Button variant="primary" onClick={vm.handleEmbeddedSignup} disabled={vm.saving || !vm.sdkReady}>{vm.saving ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}{vm.saving ? "Aguardando conexão?" : "Continuar na Meta"}</Button>{vm.awaitingAuthorization && <Button variant="ghost" onClick={vm.cancelSignup}>Cancelar</Button>}{!vm.sdkReady && !vm.connectError && <span role="status">Preparando autorização da Meta…</span>}</div>
              <p className="whatsapp-seller__setup-help">Use os dados da empresa que vai operar este número. Se a Meta informar limite de números, a empresa deve solicitar capacidade no seu WhatsApp Manager.</p>
            </section>}
          </>}
        </div>}
      </>}
    </div>
  );
}
