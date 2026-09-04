import React from "react";
import { MessageCircle, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "../../../components/Button.js";
import type { MerchantProfile } from "../../../api-client.js";
import { useWhatsAppSellerPage } from "../../whatsapp-seller/useWhatsAppSellerPage.js";

interface StepWhatsAppProps {
  me: MerchantProfile;
}

/**
 * Onboarding step 5 — connect WhatsApp Business via Meta Embedded Signup.
 * Reuses the WhatsApp Seller page view-model (same connect flow / WABA OAuth)
 * so the wizard and the standalone page stay in lockstep.
 */
export function StepWhatsApp({ me }: StepWhatsAppProps) {
  const vm = useWhatsAppSellerPage({ me });
  const status = vm.config?.status ?? "disconnected";
  const connected = status === "active" || status === "pending_verification";

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
        O WhatsApp é o canal principal do seu checkout assistido: recuperação de
        carrinho, código de acesso (OTP), confirmação de pedido e pós-venda são
        enviados por lá. Conecte sua conta do WhatsApp Business para ativar.
      </p>

      {connected ? (
        <div className="onb-connected" role="status">
          <CheckCircle size={16} aria-hidden="true" />
          <div>
            <strong>WhatsApp conectado</strong>
            {vm.config?.whatsappNumber && (
              <span className="onb-connected-sub">
                Número +{vm.config.whatsappNumber}
              </span>
            )}
          </div>
        </div>
      ) : (
        <>
          <Button
            variant="primary"
            arrow
            disabled={vm.saving || !vm.sdkReady}
            onClick={vm.handleEmbeddedSignup}
          >
            {vm.saving ? "Conectando…" : vm.sdkReady ? "Conectar WhatsApp Business" : "Carregando SDK…"}
          </Button>
          {vm.connectError && (
            <div className="onb-message" role="alert">{vm.connectError}</div>
          )}
          <p className="onb-help onb-help-muted">
            Você será redirecionado ao Meta para autorizar o número. Precisa de uma
            conta do WhatsApp Business.
          </p>
        </>
      )}
    </div>
  );
}
