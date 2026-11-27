import React from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import {
  WHATSAPP_META_BILLING_URL,
  WHATSAPP_META_PRICING_URL,
} from "../../lib/whatsapp-billing.js";

export function MarketingBillingNotice() {
  return (
    <aside
      className="marketing-billing-notice"
      aria-label="Cobrança de promoções pelo WhatsApp"
    >
      <CreditCard size={20} aria-hidden="true" />
      <div>
        <h3>Promoções pelo WhatsApp podem ter custo</h3>
        <p>
          Templates promocionais podem ser cobrados pela Meta por mensagem
          entregue. Esse valor é separado da assinatura Zyon.
        </p>
        <p>
          Confira na Meta se a conta WhatsApp Business da sua loja já tem uma
          forma de pagamento válida. Se ainda não tiver, vincule um cartão ou
          outro método aceito antes de liberar os envios.
        </p>
        <div className="marketing-billing-notice__actions">
          <a
            className="zyn-btn zyn-btn--outline zyn-btn--sm"
            href={WHATSAPP_META_BILLING_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="zyn-btn__label">
              Vincular ou gerenciar cartão na Meta{" "}
              <ExternalLink size={15} aria-hidden="true" />
            </span>
          </a>
          <a
            href={WHATSAPP_META_PRICING_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Consultar tarifas
          </a>
        </div>
        <p className="marketing-billing-notice__hint">
          Na Meta, selecione a conta WhatsApp Business desta loja e confira as
          configurações de pagamento. O vínculo do cartão é confirmado lá.
        </p>
      </div>
    </aside>
  );
}
