import { useState } from "react";

export function useCheckoutPanels() {
  const [cartOpen, setCartOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const [userTab, setUserTab] = useState<"profile" | "agent" | "orders" | "settings">("profile");
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");

  return {
    cartOpen,
    setCartOpen,
    supportOpen,
    setSupportOpen,
    userPanelOpen,
    setUserPanelOpen,
    userTab,
    setUserTab,
    showCardForm,
    setShowCardForm,
    cardError,
    setCardError,
    colorMode,
    toggleColorMode: () => setColorMode((m) => (m === "light" ? "dark" : "light")),
  };
}

export type CheckoutPanels = ReturnType<typeof useCheckoutPanels>;
