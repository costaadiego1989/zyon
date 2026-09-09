import React from "react";
import { CheckCircle, Loader2, MessageCircle } from "lucide-react";
import { Button } from "../../../components/Button.js";
import type { MerchantProfile } from "../../../api-client.js";
import { useWhatsAppSellerPage } from "../../whatsapp-seller/useWhatsAppSellerPage.js";

interface StepWhatsAppProps {
  me: MerchantProfile;
}

/**
 * Onboarding step 5 — connect WhatsApp Business through Meta Embedded Signup.
 * It shares the connection view-model with WhatsApp Seller so both surfaces
 * submit the same direct Meta Cloud API authorization.
 */
export function StepWhatsApp({ me }: StepWhatsAppProps) {
  const vm = useWhatsAppSellerPage({ me });
  const status = vm.config?.status ?? "disconnected";
  const connected = status === "active";
  const pending = status === "provisioning";

  if (vm.loading) {
    return (
      <div className="onb-loading" role="status" aria-live="polite">
        <Loader2 size={18} className="spin" aria-hidden="true" /> Carregando…
      </div>
    );
  }

  return (
    <div className="onb-field-group">
      <div className="onb-hero-icon" aria-hidden="true">
        <MessageCircle size={22} />
      </div>

      <p className="onb-help">
        Conecte o WhatsApp Business pela integração oficial da Meta para atendimento e comunicações da loja.
        A Meta apresenta a conta Business, o número e as verificações necessárias na própria janela de conexão.
      </p>

      {connected ? (
        <div className="onb-connected" role="status">
          <CheckCircle size={16} aria-hidden="true" />
          <div>
            <strong>Conexão Meta ativa</strong>
            {vm.config?.whatsappNumber && (
              <span className="onb-connected-sub">
                Número +{vm.config.whatsappNumber}
              </span>
            )}
          </div>
        </div>
      ) : pending ? (
        <div className="onb-field-group" role="status">
          <p>A Meta está confirmando a ativação da conexão.</p>
          <Button variant="outline" disabled={vm.saving} onClick={vm.refresh}>Atualizar estado</Button>
          <Button variant="ghost" disabled={vm.saving} onClick={vm.handleDisconnect}>Interromper conexão</Button>
          {vm.connectError && <p role="alert">{vm.connectError}</p>}
        </div>
      ) : (
        <>
          {!vm.settings?.configured && <p className="onb-message" role="status">
            A conexão oficial pela Meta ainda está em preparação. Você pode concluir o cadastro e voltar depois.
          </p>}
          {vm.settings?.configured && <Button
            variant="primary"
            arrow
            disabled={vm.saving || !vm.sdkReady}
            onClick={vm.handleEmbeddedSignup}
          >
            {vm.saving ? "Conectando…" : "Conectar WhatsApp pela Meta"}
          </Button>}
          {vm.awaitingAuthorization && <Button variant="ghost" onClick={vm.cancelSignup}>Cancelar</Button>}
          {vm.connectError && (
            <div className="onb-message" role="alert">{vm.connectError}</div>
          )}
          {vm.settings?.configured && <p className="onb-help onb-help-muted">
            O popup oficial da Meta permite selecionar a conta Business e o número da loja. Templates precisam da aprovação da Meta antes do envio.
          </p>}
        </>
      )}
    </div>
  );
}
