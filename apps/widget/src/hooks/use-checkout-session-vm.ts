import { useEffect, useRef } from "react";
import type { MerchantTheme } from "@zyon/shared-types";
import { DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";
import type { WidgetConfig } from "../lib/widget-types.js";
import { useGlobalAuth } from "./use-global-auth.js";
import { useAccountHub } from "./use-account-hub.js";
import { useBuyerHub } from "./use-buyer-hub.js";
import { injectGoogleFont, injectPulseFonts, isBuyerHubEligible } from "./checkout-presentation.js";
import { useCheckoutSession } from "./use-checkout-session.js";
import { useThemeStudio } from "./use-theme-studio.js";
import { useCheckoutPanels } from "./use-checkout-panels.js";

/**
 * Session-layer sub-VM: wires session, auth (global + buyer), theme, hub,
 * font injection, and event tracking. Extracts the cross-cutting glue that
 * previously lived in the monolithic `useCheckoutAgentViewModel`.
 */
export function useCheckoutSessionVM(config: WidgetConfig) {
  const buyerLoginAttemptedKey = useRef<string | null>(null);

  const sessionState = useCheckoutSession(config);
  const { activeExperience, session, networkError, track, apiOrigin } = sessionState;
  const panels = useCheckoutPanels(activeExperience.brand.theme?.mode);

  // --- auth --------------------------------------------------------------

  const auth = useGlobalAuth({
    apiBaseUrl: sessionState.apiOrigin,
    merchantId: config.merchantId,
    defaultMerchantName: activeExperience.brand.name,
    defaultEmail: activeExperience.customer?.email ?? config.customer?.email,
  });

  useEffect(() => {
    const sessionId = session?.session_id;
    const customer = activeExperience.customer;
    if (!sessionId || !isBuyerHubEligible(customer) || auth.session) return;

    const loginKey = `${sessionId}:${customer?.email_verified ? "verified" : "pending"}:${customer?.phone_verified ? "phone" : "no-phone"}`;
    if (buyerLoginAttemptedKey.current === loginKey) return;

    buyerLoginAttemptedKey.current = loginKey;
    void auth.loginFromCheckoutSession(sessionId, config.merchantId);
  }, [activeExperience.customer, auth, auth.session, config.merchantId, session?.session_id]);

  const hub = useAccountHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: auth.session,
    enabled: auth.open && auth.panel === "hub" && Boolean(auth.session?.merchant_id),
  });

  const isBuyerSession = Boolean(auth.session?.global_user_id);
  const buyerHub = useBuyerHub({
    apiBaseUrl: sessionState.apiOrigin,
    session: isBuyerSession ? auth.session : null,
    merchantId: config.merchantId,
    enabled: isBuyerSession && panels.userPanelOpen,
    onAuthExpired: () => {
      auth.logout();
      if (session) {
        void auth.refreshBuyerFromCheckoutSession(session.session_id, config.merchantId);
      }
    },
  });

  // --- theme -------------------------------------------------------------

  const baseTheme: MerchantTheme = activeExperience.brand.theme ?? DEFAULT_MERCHANT_THEME;
  const themeStudio = useThemeStudio({
    merchantId: config.merchantId,
    baseTheme,
    session: auth.session,
    apiBaseUrl: apiOrigin,
  });
  const theme = themeStudio.resolvedTheme;

  useEffect(() => {
    injectPulseFonts();
    injectGoogleFont(theme.fontFamily);
    if (theme.fontDisplay) injectGoogleFont(theme.fontDisplay);
  }, [theme.fontDisplay, theme.fontFamily]);

  // --- event tracking ----------------------------------------------------

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ event: Parameters<typeof track>[0] }>;
      if (custom.detail?.event) void track(custom.detail.event);
    };
    window.addEventListener("aacp:checkout-event", listener);
    return () => {
      window.removeEventListener("aacp:checkout-event", listener);
    };
  }, [track]);

  return {
    sessionState,
    panels,
    activeExperience,
    session,
    networkError,
    apiOrigin,
    auth,
    hub,
    buyerHub,
    isBuyerSession,
    theme,
    themeStudio,
  };
}
