import React from "react";
import type { TabKey } from "../../shell/nav-config.js";

interface AccessModalState {
  open: boolean;
  requiredTab: TabKey | null;
  trigger: (tab: TabKey) => void;
  close: () => void;
}

const AccessModalContext = React.createContext<AccessModalState | null>(null);

export function AccessModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [requiredTab, setRequiredTab] = React.useState<TabKey | null>(null);

  const trigger = React.useCallback((tab: TabKey) => {
    setOpen(true);
    setRequiredTab(tab);
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    setRequiredTab(null);
  }, []);

  const value = React.useMemo(
    () => ({ open, requiredTab, trigger, close }),
    [open, requiredTab, trigger, close],
  );

  return <AccessModalContext.Provider value={value}>{children}</AccessModalContext.Provider>;
}

export function useAccessModal(): AccessModalState {
  const ctx = React.useContext(AccessModalContext);
  if (!ctx) {
    throw new Error("useAccessModal must be used inside <AccessModalProvider>");
  }
  return ctx;
}
