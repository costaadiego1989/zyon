import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { CheckoutProps } from '../model/types';
import { CheckoutViewModel, type DomRefs } from '../viewmodels/CheckoutViewModel';

export function useCheckoutViewModel(props: CheckoutProps) {
  const refsRef = useRef<DomRefs>({ chat: null, cam: null, wave: null, support: null });
  const vmRef = useRef<CheckoutViewModel | null>(null);

  if (!vmRef.current) {
    vmRef.current = new CheckoutViewModel(props, refsRef.current);
  }

  const vm = vmRef.current;

  useEffect(() => {
    vm.updateProps(props);
  }, [vm, props]);

  useSyncExternalStore(
    (cb) => vm.subscribe(cb),
    () => vm.version,
    () => vm.version,
  );

  useEffect(() => {
    vm.mount();
    return () => vm.unmount();
  }, [vm]);

  useEffect(() => {
    vm.onUpdate();
  });

  return {
    vm,
    state: vm.getRenderState(),
  };
}
