import { CrossSellBanner } from "../../components/checkout/CrossSellBanner.js";
import { ProductSearchResults } from "../../components/checkout/ProductSearchResults.js";
import { CreditCardForm } from "../../components/checkout/CreditCardForm.js";
import { CryptoPaymentPanel } from "../../components/checkout/CryptoPaymentPanel.js";
import { ShippingSelector } from "../../components/checkout/ShippingSelector.js";
import { quickReplyId } from "../../hooks/checkout-presentation.js";
import type { CheckoutPanelsModel } from "../../presentation/models/checkout-panels.model.js";
import {
  CouponBoxView,
  NetworkErrorView,
  OfferBannerView,
  PendingOfferBannerView,
} from "./CheckoutActionPanels.js";

type CheckoutPanelsProps = {
  model: CheckoutPanelsModel;
  className?: string;
};

export function CheckoutPanels({ model, className }: CheckoutPanelsProps) {
  return (
    <div className={className}>
      {model.networkError ? <NetworkErrorView model={model.networkError} /> : null}
      {model.offerBanner ? <OfferBannerView model={model.offerBanner} /> : null}
      {model.shipping ? (
        <ShippingSelector
          options={model.shipping.options}
          selectedMethod={model.shipping.selectedMethod}
          onSelect={(opt) => void model.shipping!.onSelect(opt)}
          busy={model.shipping.busy}
        />
      ) : null}
      {model.catalogResults ? (
        <ProductSearchResults
          products={model.catalogResults.products}
          currency={model.catalogResults.currency}
          onAdd={model.catalogResults.onAdd}
        />
      ) : null}
      {model.crossSell ? (
        <CrossSellBanner
          products={model.crossSell.products}
          currency={model.crossSell.currency}
          onAdd={model.crossSell.onAdd}
          onDismiss={model.crossSell.onDismiss}
          onProceedToPayment={model.crossSell.onProceedToPayment}
        />
      ) : null}
      {model.pendingOffer ? <PendingOfferBannerView model={model.pendingOffer} /> : null}
      {model.couponBox ? <CouponBoxView model={model.couponBox} /> : null}
      {model.creditCardForm ? <CreditCardForm model={model.creditCardForm} /> : null}
      {model.cryptoPanel ? <CryptoPaymentPanel model={model.cryptoPanel} /> : null}
      {model.quickReplies ? (
        <CheckoutQuickReplies model={model.quickReplies} />
      ) : null}
    </div>
  );
}

function CheckoutQuickReplies({
  model,
}: {
  model: NonNullable<CheckoutPanelsModel["quickReplies"]>;
}) {
  const isVoice = model.variant === "voice";

  return (
    <div
      className={
        isVoice
          ? "zyon-voice-chips"
          : "zyon-quick-replies zyon-quick-replies--in-thread"
      }
      role="group"
      aria-label="Respostas sugeridas"
    >
      {model.items.map((reply) => (
        <button
          key={quickReplyId(reply)}
          type="button"
          className={isVoice ? "zyon-voice-chip" : "zyon-chip"}
          onClick={() => void model.onTap(reply)}
          disabled={model.disabled}
        >
          {reply.label}
        </button>
      ))}
    </div>
  );
}
