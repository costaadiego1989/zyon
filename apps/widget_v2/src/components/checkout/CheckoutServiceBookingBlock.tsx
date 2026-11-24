import { useCheckoutStore } from "../../store/checkout-store";
import { ServiceBookingPicker } from "./ServiceBookingPicker";
import { ServiceBookingUncertainError } from "../../api/service-booking";

/** Service-only block mounted by the existing checkout renderer. */
export function CheckoutServiceBookingBlock({ data }: { data: unknown }) {
  const api = useCheckoutStore(state => state.api);
  const access = api?.serviceBookingAccess ?? null;
  const readAccess = api?.serviceBookingReadAccess ?? null;
  return <ServiceBookingPicker data={data} access={access} readAccess={readAccess}
    onRefreshContext={() => { void useCheckoutStore.getState().sendMessage("Quero consultar os serviços e os horários disponíveis"); }}
    onReviewCheckout={api ? async () => { try { await api.start(); } catch { throw new ServiceBookingUncertainError(); } } : undefined}
    onCheckout={access ? () => { void useCheckoutStore.getState().init(access); } : undefined} />;
}
