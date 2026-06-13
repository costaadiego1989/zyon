import { useEffect, useState } from "react";

const COLOR_MODE_KEY = "aacp_color_mode";

function readStoredColorMode(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(COLOR_MODE_KEY) === "dark" ? "dark" : "light";
}

export function useCheckoutPanels() {
  const [cartOpen, setCartOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [buyerGuestModalOpen, setBuyerGuestModalOpen] = useState(false);
  const [userTab, setUserTab] = useState<"profile" | "agent" | "orders" | "settings">("profile");
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<"light" | "dark">(readStoredColorMode);

  useEffect(() => {
    window.localStorage.setItem(COLOR_MODE_KEY, colorMode);
  }, [colorMode]);

  return {
    cartOpen,
    setCartOpen,
    supportOpen,
    setSupportOpen,
    userPanelOpen,
    setUserPanelOpen,
    buyerGuestModalOpen,
    setBuyerGuestModalOpen,
    userTab,
    setUserTab,
    showCardForm,
    setShowCardForm,
    cardError,
    setCardError,
    colorMode,
    toggleColorMode: () => setColorMode((m) => (m === "light" ? "dark" : "light")),
    resetPanels: () => {
      setCartOpen(false);
      setSupportOpen(false);
      setBuyerGuestModalOpen(false);
      setShowCardForm(false);
      setCardError(null);
    },
  };
}

export type CheckoutPanels = ReturnType<typeof useCheckoutPanels>;
