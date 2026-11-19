import { useCallback, useEffect, useState } from "react";
import { readWhatsAppRoute, whatsAppRouteUrl, type WhatsAppTab } from "./conversation-navigation.js";
import type { ConversationNavigation } from "./useConversationNavigation.js";

export function useWhatsAppRoute(role: unknown, navigation?: ConversationNavigation) {
  const read = useCallback(() => readWhatsAppRoute(window.location.hash || "#whatsapp-seller", role), [role]);
  const [state, setState] = useState(() => ({ role, route: read() }));
  useEffect(() => {
    const changed = () => setState({ role, route: read() });
    if (!window.location.hash) {
      window.history.replaceState(window.history.state, "", whatsAppRouteUrl(role === "STAFF" ? "conversations" : "connection"));
      navigation?.reset();
    }
    changed(); window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [role, read, navigation]);
  const navigate = useCallback((tab: WhatsAppTab, ticketId: string | null = null) => {
    const hash = whatsAppRouteUrl(tab, ticketId, window.location.hash);
    const commit = () => {
      if (window.location.hash !== hash) window.location.hash = hash;
      setState({ role, route: readWhatsAppRoute(hash, role) });
    };
    if (navigation) navigation.request(hash, commit); else commit();
  }, [role, navigation]);
  return { ...(state.role === role ? state.route : read()), navigate };
}
