import { Tag } from "lucide-react";
import { Gift } from "lucide-react";
import type {
  CouponBoxModel,
  NetworkErrorModel,
  OfferBannerModel,
  PendingOfferBannerModel,
} from "../../presentation/models/checkout-action-panels.model.js";

export function NetworkErrorView({ model }: { model: NetworkErrorModel }) {
  return (
    <div className="aacp-network-error" role="alert">
      <span>{model.message}</span>
      <button type="button" onClick={model.onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

export function CouponBoxView({ model }: { model: CouponBoxModel }) {
  return (
    <form
      className="aacp-coupon-box mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void model.onSubmit();
      }}
    >
      <div className="relative flex-1">
        <Tag
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--aacp-muted)]"
          aria-hidden="true"
        />
        <input
          className="w-full rounded-xl border border-[var(--aacp-line)] bg-[var(--aacp-surface-2)] pl-9 pr-3 py-2.5 text-sm text-[var(--aacp-fg)] placeholder:text-[var(--aacp-muted)] focus:outline-none focus:border-[var(--aacp-accent)]"
          value={model.value}
          onChange={(e) => model.onChange(e.target.value)}
          placeholder="Código do cupom"
          aria-label="Cupom de desconto"
          disabled={model.busy}
          autoComplete="off"
        />
      </div>
      <button
        type="submit"
        disabled={!model.value.trim() || model.busy}
        className="aacp-coupon-submit"
      >
        Aplicar
      </button>
    </form>
  );
}

export function OfferBannerView({ model }: { model: OfferBannerModel }) {
  return (
    <div className="aacp-offer aacp-offer-banner aacp-offer-banner--applied">
      <div className="aacp-offer-icon">
        <Gift size={18} />
      </div>
      <div className="aacp-offer-text">
        <strong>Oferta aplicada</strong>
        <span>
          -{model.discountLabel}
          {model.shippingLabel ? (
            <>
              {" "}
              · pedido <b>{model.orderTotalLabel}</b> (inclui frete de {model.shippingLabel})
            </>
          ) : (
            <>
              {" "}
              · novo total <b>{model.orderTotalLabel}</b>
            </>
          )}
        </span>
      </div>
      <button
        type="button"
        className="aacp-offer-cta"
        onClick={() => void model.onContinue()}
        disabled={model.busy}
      >
        Continuar
      </button>
    </div>
  );
}

export function PendingOfferBannerView({ model }: { model: PendingOfferBannerModel }) {
  return (
    <div className="aacp-offer aacp-offer-banner aacp-pending-offer">
      <div className="aacp-offer-icon aacp-pending-offer-icon">
        <Gift size={20} />
      </div>
      <div className="aacp-offer-text">
        <strong>Oferta exclusiva para você</strong>
        <span>
          Preparamos {model.savingsLabel} se você finalizar agora. Aproveite antes de pagar.
        </span>
      </div>
      <button
        type="button"
        className="aacp-offer-cta aacp-pending-offer-cta"
        onClick={() => void model.onApply()}
        disabled={model.busy}
      >
        Aplicar oferta
      </button>
    </div>
  );
}
