import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState
} from "react";

export interface TriggerOnlyModeHandle {
  trigger: () => void;
  dismiss: () => void;
  isVisible: () => boolean;
}

export interface TriggerOnlyModeProps {
  onTrigger?: () => void;
  children: (api: { trigger: () => void }) => React.ReactNode;
}

export const TriggerOnlyMode = forwardRef<TriggerOnlyModeHandle, TriggerOnlyModeProps>(
  ({ onTrigger, children }, ref) => {
    const [visible, setVisible] = useState(false);

    const trigger = useCallback(() => {
      setVisible(true);
      onTrigger?.();
    }, [onTrigger]);

    const dismiss = useCallback(() => setVisible(false), []);

    useImperativeHandle(ref, () => ({ trigger, dismiss, isVisible: () => visible }), [trigger, dismiss, visible]);

    useEffect(() => {
      const handler = (event: Event) => {
        const ce = event.target as Element | null;
        if (ce?.tagName?.toLowerCase() === "zyon-checkout-agent") {
          trigger();
        }
      };
      window.addEventListener("zyon-checkout-agent:open", handler);
      return () => window.removeEventListener("zyon-checkout-agent:open", handler);
    }, [trigger]);

    if (!visible) return null;
    return <>{children({ trigger })}</>;
  }
);

TriggerOnlyMode.displayName = "TriggerOnlyMode";
