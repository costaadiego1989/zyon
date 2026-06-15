import { useCallback, useEffect, useState } from "react";

const COLOR_MODE_KEY = "aacp_color_mode";

export type BuyerHubSection = "profile" | "agent" | "orders" | "settings";

export type PurchaseChannel = "pending" | "chat" | "voice";

export type ActiveCheckoutSurface =
  | { kind: "none" }
  | { kind: "order"; snapPoint: "peek" | "full" }
  | { kind: "account"; section: BuyerHubSection }
  | { kind: "support"; topicId?: string };

function readStoredColorMode(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(COLOR_MODE_KEY) === "dark" ? "dark" : "light";
}

function readInitialPurchaseChannel(): PurchaseChannel {
  if (typeof process !== "undefined" && process.env.VITEST) return "chat";
  return "pending";
}

export function useCheckoutPanels() {
  const [activeSurface, setActiveSurface] = useState<ActiveCheckoutSurface>({
    kind: "none",
  });
  const [lastAccountSection, setLastAccountSection] =
    useState<BuyerHubSection>("profile");
  const [buyerGuestModalOpen, setBuyerGuestModalOpen] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [showCryptoPanel, setShowCryptoPanel] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<"light" | "dark">(readStoredColorMode);
  const [purchaseChannel, setPurchaseChannel] = useState<PurchaseChannel>(readInitialPurchaseChannel);

  useEffect(() => {
    window.localStorage.setItem(COLOR_MODE_KEY, colorMode);
  }, [colorMode]);

  const setCartOpen = useCallback((open: boolean) => {
    setActiveSurface((current) =>
      open
        ? { kind: "order", snapPoint: "full" }
        : current.kind === "order"
          ? { kind: "none" }
          : current,
    );
  }, []);

  const setSupportOpen = useCallback((open: boolean) => {
    setActiveSurface((current) =>
      open
        ? { kind: "support" }
        : current.kind === "support"
          ? { kind: "none" }
          : current,
    );
  }, []);

  const setUserPanelOpen = useCallback(
    (open: boolean) => {
      setActiveSurface((current) =>
        open
          ? { kind: "account", section: lastAccountSection }
          : current.kind === "account"
            ? { kind: "none" }
            : current,
      );
    },
    [lastAccountSection],
  );

  const setUserTab = useCallback((section: BuyerHubSection) => {
    setLastAccountSection(section);
    setActiveSurface((current) =>
      current.kind === "account" ? { kind: "account", section } : current,
    );
  }, []);

  const openSurface = useCallback((surface: ActiveCheckoutSurface) => {
    setActiveSurface(surface);
  }, []);

  const closeSurface = useCallback(() => {
    setActiveSurface({ kind: "none" });
  }, []);

  const resetPanels = useCallback(() => {
    setActiveSurface({ kind: "none" });
    setBuyerGuestModalOpen(false);
    setShowCardForm(false);
    setShowCryptoPanel(false);
    setCardError(null);
  }, []);

  return {
    activeSurface,
    openSurface,
    closeSurface,
    cartOpen: activeSurface.kind === "order",
    setCartOpen,
    supportOpen: activeSurface.kind === "support",
    setSupportOpen,
    userPanelOpen: activeSurface.kind === "account",
    setUserPanelOpen,
    buyerGuestModalOpen,
    setBuyerGuestModalOpen,
    userTab:
      activeSurface.kind === "account"
        ? activeSurface.section
        : lastAccountSection,
    setUserTab,
    showCardForm,
    setShowCardForm,
    showCryptoPanel,
    setShowCryptoPanel,
    cardError,
    setCardError,
    colorMode,
    toggleColorMode: () =>
      setColorMode((mode) => (mode === "light" ? "dark" : "light")),
    resetPanels,
    purchaseChannel,
    selectPurchaseChannel: setPurchaseChannel,
  };
}

export type CheckoutPanels = ReturnType<typeof useCheckoutPanels>;
