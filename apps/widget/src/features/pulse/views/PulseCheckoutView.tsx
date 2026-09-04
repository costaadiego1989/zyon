import type { CheckoutProps } from '../model/types';
import { useCheckoutViewModel } from '../hooks/useCheckoutViewModel';
import { PulseWidget } from './PulseWidget';

export function PulseCheckoutView(props: CheckoutProps) {
  const { state } = useCheckoutViewModel(props);
  return <PulseWidget s={state} />;
}
