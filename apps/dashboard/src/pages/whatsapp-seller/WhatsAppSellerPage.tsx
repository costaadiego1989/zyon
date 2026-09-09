import React, { useState } from "react";
import { CheckCircle, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "../../components/Button.js";
import { TabBar } from "../../components/TabBar.js";
import type { MerchantProfile } from "../../api-client.js";
import { useWhatsAppSellerPage } from "./useWhatsAppSellerPage.js";
import { WhatsAppTemplatesTab } from "./WhatsAppTemplatesTab.js";
import { PremiumFeatureGate } from "../../components/PremiumFeatureGate.js";
import "./whatsapp-seller.css";

const stateCopy: Record<string, { title: string; text: string }> = {
  provisioning: { title: "Ativando conexão", text: "A Meta está confirmando a ativação do canal. Atualize o estado em instantes." },
  inactive: { title: "Conexão inativa", text: "A conexão com a Meta ainda não está ativa. Atualize o estado ou refaça a conexão oficial." },
  error: { title: "Conexão não concluída", text: "O canal ainda não está disponível. Você pode iniciar uma nova conexão pela Meta." },
};

export function WhatsAppSellerPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useWhatsAppSellerPage({ me: props.me });
  const [tab, setTab] = useState<"connection" | "templates">("connection");
  const status = vm.config?.status ?? "disconnected";
  const pending = stateCopy[status];
  const active = status === "active";
  const canStart = vm.config && ["disconnected", "error", "inactive"].includes(status);

  return (
    <div className="page-container whatsapp-seller">
      <header className="page-head">
        <div>
          <span className="eyebrow">Integrações</span>
          <h1>WhatsApp Seller</h1>
          <p className="page-lead">Conecte o WhatsApp Business da sua loja pela integração oficial da Meta.</p>
        </div>
        {active && <span className="whatsapp-seller__connected"><CheckCircle size={16} /> Conexão Meta ativa</span>}
      </header>
      {!props.me ? <p>Entre na sua conta para configurar o WhatsApp.</p> : <>
        <TabBar tabs={[{ key: "connection", label: "Conexão" }, { key: "templates", label: "Templates" }]}
          activeTab={tab} onTabChange={key => setTab(key as "connection" | "templates")} />
        {tab === "templates" && <PremiumFeatureGate feature="postSale" requiredPlan="Growth" featureLabel="Templates de WhatsApp">
          <WhatsAppTemplatesTab me={props.me} />
        </PremiumFeatureGate>}
        {tab === "connection" && <div className="whatsapp-seller__content">
          {vm.loading && <p role="status" className="whatsapp-seller__inline"><Loader2 size={18} className="spin" /> Carregando conexão…</p>}
          {vm.connectError && <div className="whatsapp-seller__error" role="alert">
            <p>{vm.connectError}</p>
            <Button variant="outline" size="sm" disabled={vm.saving || vm.loading} onClick={vm.config ? vm.refresh : vm.load}>
              <RefreshCw size={14} /> {vm.config ? "Atualizar estado" : "Tentar novamente"}
            </Button>
          </div>}
          {!vm.loading && vm.config && <>
            {!vm.settings?.configured && <div className="panel whatsapp-seller__panel" role="status">
              <h2>Conexão oficial em preparação</h2>
              <p>A conexão oficial pela Meta ainda está sendo configurada pela Zyon. Volte a esta tela quando ela estiver disponível.</p>
            </div>}
            {active && <section className="panel whatsapp-seller__panel">
              <div className="whatsapp-seller__row">
                <div>
                  <h2>Conexão ativa</h2>
                  <p className="whatsapp-seller__number">+{vm.config.whatsappNumber}</p>
                  <p>{vm.config.enabled ? "O WhatsApp da loja está ativo para atendimento e comunicações autorizadas." : "As comunicações desta loja estão pausadas."}</p>
                </div>
                <Button variant={vm.config.enabled ? "outline" : "primary"} disabled={vm.saving}
                  onClick={() => vm.handleToggleEnabled(!vm.config!.enabled)}>
                  {vm.config.enabled ? "Pausar canal" : "Habilitar canal"}
                </Button>
              </div>
              <p>Para testar a recepção, envie uma mensagem de outro WhatsApp para este número.</p>
              <div className="whatsapp-seller__actions">
                <Button variant="outline" disabled={vm.saving} onClick={vm.refresh}><RefreshCw size={16} /> Atualizar conexão</Button>
                <Button variant="ghost" disabled={vm.saving} onClick={vm.handleDisconnect}>Desconectar da loja</Button>
              </div>
              <p className="whatsapp-seller__hint">Desconectar desativa o canal na Zyon. O número continua associado à conta Business selecionada na Meta.</p>
            </section>}
            {pending && !active && <section className="panel whatsapp-seller__panel" aria-live="polite">
              <h2>{pending.title}</h2>
              {vm.config.whatsappNumber && <p className="whatsapp-seller__number">+{vm.config.whatsappNumber}</p>}
              <p>{pending.text}</p>
              <div className="whatsapp-seller__actions">
                <Button variant="outline" disabled={vm.saving} onClick={vm.refresh}><RefreshCw size={16} /> Atualizar estado</Button>
                {status === "provisioning" && <Button variant="ghost" disabled={vm.saving} onClick={vm.handleDisconnect}>Interromper conexão</Button>}
              </div>
            </section>}
            {canStart && vm.settings?.configured && <section className="panel whatsapp-seller__panel">
              <span className="eyebrow">Conexão oficial pela Meta</span>
              <h2>Escolha o número dentro da Meta</h2>
              <p>Ao continuar, a janela oficial da Meta permite escolher a conta Business e o número da loja. A própria Meta conduz as verificações necessárias.</p>
              <div className="whatsapp-seller__actions">
                <Button variant="primary" onClick={vm.handleEmbeddedSignup}
                  disabled={vm.saving || !vm.sdkReady}>
                  {vm.saving ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
                  {vm.saving ? "Aguardando conexão…" : "Conectar WhatsApp pela Meta"}
                </Button>
                {vm.awaitingAuthorization && <Button variant="ghost" onClick={vm.cancelSignup}>Cancelar</Button>}
              </div>
              {!vm.sdkReady && !vm.connectError && <p role="status">Preparando a autorização da Meta…</p>}
            </section>}
            <section className="whatsapp-seller__guidance">
              <ShieldCheck size={20} aria-hidden="true" />
              <div>
                <h2>Templates aprovados antes do envio</h2>
                <p>Confirmações e recuperação de carrinho usam templates da loja. O envio por WhatsApp depende de conexão ativa, autorização do cliente e aprovação dos templates pela Meta.</p>
                <Button variant="ghost" onClick={() => setTab("templates")}>Ver templates da loja</Button>
              </div>
            </section>
          </>}
        </div>}
      </>}
    </div>
  );
}
