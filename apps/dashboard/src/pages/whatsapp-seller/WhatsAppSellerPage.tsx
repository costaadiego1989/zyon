import { formatWhatsAppPhone } from "../../utils/masks.js";
﻿import { PageHeader } from "../../components/PageHeader.js";
import React, { useLayoutEffect, useRef } from "react";
import { CheckCircle, CircleCheck, CreditCard, ExternalLink, Loader2, PackageCheck, RefreshCw, ShieldCheck, ShoppingBag, X } from "lucide-react";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import type { MerchantProfile } from "../../api-client.js";
import { useWhatsAppSellerPage } from "./useWhatsAppSellerPage.js";
import { useWhatsAppUsage } from "./useWhatsAppUsage.js";
import { WhatsAppUsageTab, WhatsAppProcessingNotice } from "./WhatsAppUsageTab.js";
import { WhatsAppTemplatesTab } from "./WhatsAppTemplatesTab.js";
import { WhatsAppBrandIcon } from "../../components/WhatsAppBrandIcon.js";
import { PremiumFeatureGate } from "../../components/PremiumFeatureGate.js";
import { canConfigureWhatsApp } from "../../lib/auth/permissions.js";
import { WhatsAppConversationsTab } from "./WhatsAppConversationsTab.js";
import { useWhatsAppRoute } from "./useWhatsAppRoute.js";
import type { WhatsAppTab } from "./conversation-navigation.js";
import type { ConversationNavigation } from "./useConversationNavigation.js";
import "./whatsapp-seller.css";

const stateCopy: Record<string, { title: string; text: string }> = {
  provisioning: { title: "Ativando conexão", text: "A Meta está confirmando a ativação do canal. Atualize o estado em instantes." },
  inactive: { title: "Conexão inativa", text: "A conexão com a Meta ainda não está ativa. Atualize o estado ou refaça a conexão oficial." },
  error: { title: "Conexão não concluída", text: "O canal ainda não está disponível. Você pode iniciar uma nova conexão pela Meta." },
};

const whatsappManagerUrl = "https://business.facebook.com/wa/manage/phone-numbers/";
const WHATSAPP_TABS = [{ key: "connection", label: "Conexão", panelId: "whatsapp-connection" }, { key: "templates", label: "Modelos de mensagem", panelId: "whatsapp-templates" }, { key: "orders", label: "Pedidos no WhatsApp", panelId: "whatsapp-orders" }, { key: "usage", label: "Consumo e cobrança", panelId: "whatsapp-usage" }, { key: "conversations", label: "Conversas", panelId: "whatsapp-conversations" }];

export function WhatsAppSellerPage(props: { apiBaseUrl: string; me: MerchantProfile | null; navigation?: ConversationNavigation }) {
  const route = useWhatsAppRoute(props.me?.role, props.navigation);
  const conversationsHost = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!route.allowed || route.tab !== "conversations") return;
    const strip = conversationsHost.current?.querySelector<HTMLElement>('[role="tablist"]');
    const selected = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!strip || !selected || !strip.clientWidth) return;
    const bounds = strip.getBoundingClientRect(), active = selected.getBoundingClientRect();
    const left = bounds.left + strip.clientLeft, right = left + strip.clientWidth;
    if (active.left < left) strip.scrollLeft += active.left - left;
    else if (active.right > right) strip.scrollLeft += active.right - right;
  }, [route.allowed, route.tab, props.me?.id]);
  if (!props.me) return <div className="page-container whatsapp-seller"><PageHeader title="WhatsApp" /><p>Entre na sua conta para configurar o WhatsApp.</p></div>;
  if (!route.allowed || !route.tab) return <div className="page-container whatsapp-seller"><PageHeader title="WhatsApp" />
    <div className="panel-error" role="alert"><p>Esta opção não está disponível para seu perfil.</p>
      <Button variant="outline" onClick={() => route.navigate(canConfigureWhatsApp(props.me?.role) ? "connection" : "conversations")}>Abrir WhatsApp</Button></div></div>;
  if (route.tab === "conversations") return <div ref={conversationsHost} className="page-container whatsapp-seller">
    <PageHeader title="WhatsApp" description="Acompanhe as conversas e cuide do atendimento aos clientes." />
    <TabBar tabs={WHATSAPP_TABS} activeTab="conversations" label="WhatsApp" onTabChange={key => route.navigate(key as WhatsAppTab)} />
    <WhatsAppConversationsTab apiBaseUrl={props.apiBaseUrl} expectedMerchantId={props.me.id} ticketId={route.ticketId} navigation={props.navigation}
      onSelectTicket={id => route.navigate("conversations", id)} onCloseTicket={() => route.navigate("conversations")} />
  </div>;
  return <WhatsAppConfigurationPage {...props} tab={route.tab} onTabChange={tab => route.navigate(tab)} />;
}

function WhatsAppConfigurationPage(props: { apiBaseUrl: string; me: MerchantProfile | null; tab: Exclude<WhatsAppTab, "conversations">; onTabChange: (tab: WhatsAppTab) => void }) {
  const vm = useWhatsAppSellerPage({ me: props.me });
  const usage = useWhatsAppUsage(props.me?.id);
  const tab = props.tab, setTab = props.onTabChange;
  const status = vm.config?.status ?? "disconnected";
  const pending = stateCopy[status];
  const active = status === "active";
  const canStart = vm.config && ["disconnected", "error", "inactive"].includes(status);

  return (
    <div className="page-container whatsapp-seller">
      <PageHeader
        title="WhatsApp"
        description="Conecte o WhatsApp Business da sua loja pela integração oficial da Meta."
        actions={active ? <span className="whatsapp-seller__connected"><CheckCircle size={16} /> Conexão Meta ativa</span> : undefined}
      />

      {!props.me ? <p>Entre na sua conta para configurar o WhatsApp.</p> : <>
        <TabBar
          tabs={WHATSAPP_TABS}
          activeTab={tab}
          onTabChange={key => setTab(key as WhatsAppTab)}
          label="Configurações do WhatsApp"
        />
        {tab === "usage" && <WhatsAppUsageTab vm={usage} />}

        {tab === "templates" && <section id="whatsapp-templates" role="tabpanel" aria-labelledby="whatsapp-templates-tab">
          <PremiumFeatureGate feature="postSale" requiredPlan="Growth" featureLabel="Modelos de mensagem do WhatsApp">
            <WhatsAppTemplatesTab me={props.me} />
          </PremiumFeatureGate>
        </section>}

        {tab === "orders" && <section id="whatsapp-orders" role="tabpanel" aria-labelledby="whatsapp-orders-tab" className="whatsapp-seller__content">
          <section className="panel whatsapp-seller__panel whatsapp-seller__orders">
            <span className="whatsapp-seller__eyebrow">Venda e atendimento no mesmo canal</span>
            <h2>Transforme conversas em compras assistidas</h2>
            <p>Com o canal ativo, clientes podem iniciar uma conversa pelo WhatsApp da loja, consultar produtos e seguir para o checkout. A confirmação do pedido continua vinculada ao pagamento e às regras da loja.</p>
            <div className="whatsapp-seller__order-flow" aria-label="Fluxo de pedidos pelo WhatsApp">
              <div><WhatsAppBrandIcon size={22} /><strong>Cliente chama a loja</strong><small>O canal recebe a mensagem e inicia o atendimento.</small></div>
              <div><ShoppingBag size={20} /><strong>Produtos e compra</strong><small>A conversa pode apresentar opções e orientar o cliente até o checkout.</small></div>
              <div><CreditCard size={20} /><strong>Pagamento autorizado</strong><small>Quando aplicável, o cliente recebe PIX ou link de pagamento.</small></div>
              <div><PackageCheck size={20} /><strong>Atualizações do pedido</strong><small>Confirmação, envio e entrega usam os modelos aprovados pela Meta.</small></div>
            </div>
          </section>
          <section className="panel whatsapp-seller__guidance whatsapp-seller__orders-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <div><h2>O que sua loja recebe</h2><p>Mensagens recebidas por este número entram no fluxo de atendimento e compra da Zyon. A loja só deve confirmar o pedido depois do checkout e do pagamento autoritativo; uma conversa isolada não cria cobrança ou pedido.</p></div>
          </section>
        </section>}
        {tab === "connection" && <section id="whatsapp-connection" role="tabpanel" aria-labelledby="whatsapp-connection-tab" className="whatsapp-seller__content">
          <WhatsAppProcessingNotice data={usage.data} onView={() => setTab("usage")} />
          {vm.loading && <p role="status" className="whatsapp-seller__inline"><Loader2 size={18} className="spin" /> Carregando conexão…</p>}

          {vm.connectError && <div className="whatsapp-seller__error" role="alert">
            <div><strong>Não foi possível concluir a conexão</strong><p>{vm.connectError}</p></div>
            <Button variant="outline" size="sm" disabled={vm.saving || vm.loading} onClick={vm.config ? vm.refresh : vm.load}>
              <RefreshCw size={14} /> {vm.config ? "Atualizar estado" : "Tentar novamente"}
            </Button>
          </div>}

          {!vm.loading && vm.config && <>
            {!vm.settings?.configured && <section className="panel whatsapp-seller__panel" role="status">
              <h2>Conexão oficial em preparação</h2>
              <p>A conexão oficial pela Meta ainda está sendo configurada pela Zyon. Volte a esta tela quando ela estiver disponível.</p>
            </section>}

            {active && <section className="panel whatsapp-seller__panel whatsapp-seller__connection-panel">
              <div className="whatsapp-seller__panel-heading">
                <div className="whatsapp-seller__identity-icon" aria-hidden="true"><WhatsAppBrandIcon size={25} /></div>
                <div>
                  <span className="whatsapp-seller__eyebrow">Canal conectado</span>
                  <h2>WhatsApp Business ativo</h2>
                  <p className="whatsapp-seller__number">{formatWhatsAppPhone(vm.config.whatsappNumber)}</p>
                </div>
                <Button variant={vm.config.enabled ? "outline" : "primary"} disabled={vm.saving} onClick={() => vm.handleToggleEnabled(!vm.config!.enabled)}>
                  {vm.config.enabled ? "Pausar canal" : "Habilitar canal"}
                </Button>
              </div>

              <div className="whatsapp-seller__readiness" aria-label="Prontidão do canal">
                <div><CircleCheck size={18} aria-hidden="true" /><span><strong>Atendimento</strong><small>{vm.config.enabled ? "Receba e responda mensagens pelo canal da loja." : "O canal está pausado para novos atendimentos."}</small></span><b className={vm.config.enabled ? "is-success" : undefined}>{vm.config.enabled ? "Ativo" : "Pausado"}</b></div>
                <div><CircleCheck size={18} aria-hidden="true" /><span><strong>Modelos Meta</strong><small>Os modelos necessários são enviados para análise quando o canal é ativado.</small></span><button type="button" onClick={() => setTab("templates")}>Ver modelos</button></div>
                <div><CreditCard size={18} aria-hidden="true" /><span><strong>Faturamento Meta</strong><small>A empresa conecta o próprio método de pagamento na Meta para as cobranças de mensagens.</small></span><a href={whatsappManagerUrl} target="_blank" rel="noreferrer">Gerenciar <ExternalLink size={13} /></a></div>
              </div>

              <div className="whatsapp-seller__panel-footer">
                <p>Este número já pode atender clientes e apoiar vendas pelo WhatsApp. Para testar a recepção, envie uma mensagem de outro WhatsApp.</p>
                <div className="whatsapp-seller__actions">
                  <Button variant="outline" disabled={vm.saving} onClick={vm.refresh}><RefreshCw size={16} /> Atualizar conexão</Button>
                  <Button variant="ghost" disabled={vm.saving} onClick={vm.handleDisconnect}>Desconectar da loja</Button>
                </div>
              </div>
              <p className="whatsapp-seller__hint">Desconectar desativa o canal na Zyon. O número continua associado à conta Business escolhida na Meta.</p>
            </section>}

            {pending && !active && <section className="panel whatsapp-seller__panel" aria-live="polite">
              <h2>{pending.title}</h2>
              {vm.config.whatsappNumber && <p className="whatsapp-seller__number">{formatWhatsAppPhone(vm.config.whatsappNumber)}</p>}
              <p>{pending.text}</p>
              <div className="whatsapp-seller__actions">
                <Button variant="outline" disabled={vm.saving} onClick={vm.refresh}><RefreshCw size={16} /> Atualizar estado</Button>
                {status === "provisioning" && <Button variant="ghost" disabled={vm.saving} onClick={vm.handleDisconnect}>Interromper conexão</Button>}
              </div>
            </section>}

            {canStart && vm.settings?.configured && <section className="panel whatsapp-seller__panel whatsapp-seller__setup">
              <div className="whatsapp-seller__setup-copy">
                <span className="whatsapp-seller__eyebrow">Integração oficial da Meta</span>
                <h2>Conecte o WhatsApp da sua empresa</h2>
                <p>A Meta abre uma janela segura para escolher a conta Business e o número que ficará ligado à sua loja.</p>
              </div>
              <ol className="whatsapp-seller__steps">
                <li><WhatsAppBrandIcon size={19} /><span><strong>Conta e número</strong><small>Escolha a conta Business e confirme o número da empresa.</small></span></li>
                <li><CreditCard size={18} aria-hidden="true" /><span><strong>Cartão da empresa</strong><small>Adicione o método de pagamento da própria empresa na Meta.</small></span></li>
                <li><ShoppingBag size={18} aria-hidden="true" /><span><strong>Vendas no WhatsApp</strong><small>Após a conexão, a loja pode atender e enviar comunicações autorizadas.</small></span></li>
              </ol>
              <div className="whatsapp-seller__setup-action">
                <Button variant="primary" onClick={vm.handleEmbeddedSignup} disabled={vm.saving || !vm.sdkReady}>
                  {vm.saving ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
                  {vm.saving ? "Aguardando conexão…" : "Conectar WhatsApp pela Meta"}
                </Button>
                {vm.awaitingAuthorization && <Button variant="ghost" onClick={vm.cancelSignup}>Cancelar</Button>}
                {!vm.sdkReady && !vm.connectError && <span role="status">Preparando a autorização da Meta…</span>}
              </div>
            </section>}

            <section className="panel whatsapp-seller__guidance">
              <ShieldCheck size={20} aria-hidden="true" />
              <div>
                <h2>Modelos aprovados antes do envio</h2>
                <p>Confirmações, atualização de pedidos e recuperação de carrinho usam modelos de mensagem da loja. O envio depende de conexão ativa, autorização do cliente e aprovação dos modelos pela Meta.</p>
                <Button variant="ghost" onClick={() => setTab("templates")}>Ver modelos de mensagem</Button>
              </div>
            </section>
          </>}

          {vm.justConnected && <section className="panel whatsapp-seller__success" aria-live="polite">
            <button type="button" className="whatsapp-seller__success-close" aria-label="Fechar confirmação" onClick={vm.dismissConnectionSuccess}><X size={16} /></button>
            <span className="whatsapp-seller__success-mark" aria-hidden="true"><CircleCheck size={38} /><i /></span>
            <div><h2>Seu WhatsApp está pronto.</h2><p>A Zyon vai cadastrar os modelos de mensagem necessários e atualizar o estado nesta tela.</p></div>
          </section>}
        </section>}
      </>}
    </div>
  );
}
