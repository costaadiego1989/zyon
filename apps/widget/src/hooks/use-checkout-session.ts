import { useEffect, useMemo, useState } from "react";
import type {
  Cart,
  CheckoutEventName,
  CheckoutExperienceSnapshot,
  StartCheckoutResponse,
  TrackEventResponse,
  UpdateCartItemInput,
  UpdateCartResponse
} from "@aacp/shared-types";
import {
  checkoutJson,
  CHECKOUT_EMBED_PATHS,
  CHECKOUT_LEGACY_PATHS,
  normalizeApiBase
} from "../lib/embed-client.js";
import { productCartResponseSchema, startCheckoutResponseSchema, trackEventResponseSchema, updateCartResponseSchema } from "../lib/widget-schemas.js";
import type { WidgetConfig } from "../lib/widget-types.js";
import { fallbackExperience } from "./checkout-presentation.js";

export interface SessionStartedEvent {
  response: StartCheckoutResponse;
  ts: number;
}

/**
 * P1 (ADR 0002): localStorage keys are namespaced by merchantId so two
 * merchants embedded on the same origin cannot share session/identity state.
 * Legacy global keys are migrated on first access and then discarded.
 */
function sessionStorageKey(merchantId: string): string {
  return `aacp_session_id:${merchantId}`;
}
function globalUserStorageKey(merchantId: string): string {
  return `aacp_global_user_id:${merchantId}`;
}

/**
 * Reads a namespaced session id, falling back to the legacy global key once
 * for backward-compat and rewriting to the namespaced form.
 */
function readPersistedSessionId(merchantId: string): string | null {
  if (typeof window === "undefined") return null;
  const nsKey = sessionStorageKey(merchantId);
  const existing = window.localStorage.getItem(nsKey);
  if (existing) return existing;
  // One-time migration from the global key.
  const legacy = window.localStorage.getItem("aacp_session_id");
  if (legacy) {
    window.localStorage.setItem(nsKey, legacy);
    window.localStorage.removeItem("aacp_session_id");
  }
  return legacy;
}

export function useCheckoutSession(config: WidgetConfig) {
  const [session, setSession] = useState<StartCheckoutResponse | null>(null);
  const [experience, setExperience] = useState<CheckoutExperienceSnapshot | null>(null);
  const [resolvedCart, setResolvedCart] = useState<Cart>(config.cart);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [startedEvent, setStartedEvent] = useState<SessionStartedEvent | null>(null);
  const [startErrorTs, setStartErrorTs] = useState(0);

  const apiOrigin = useMemo(() => normalizeApiBase(config.apiBaseUrl), [config.apiBaseUrl]);
  const productApiOrigin = useMemo(
    () => (config.productApiBaseUrl ? normalizeApiBase(config.productApiBaseUrl) : null),
    [config.productApiBaseUrl]
  );

  // P3 (ADR 0002): validate embedSessionToken presence for embed mode instead
  // of using non-null assertion (!). This surfaces a clear setup error rather
  // than an opaque 401 downstream when the token is missing.
  const embedOpts = useMemo(() => {
    if (config.mode !== "embed") return {};
    if (!config.embedSessionToken) {
      // Emit a setup warning; the missing token will cause API calls to fail
      // with a 401, but the error message will now point at configuration.
      if (typeof console !== "undefined") {
        console.error(
          "[aacp] useCheckoutSession: mode=embed but embedSessionToken is missing. " +
          "Configure data-embed-session-token on the embed element."
        );
      }
      return {};
    }
    return { embedToken: config.embedSessionToken };
  }, [config.mode, config.embedSessionToken]);

  function syncExperience(next: CheckoutExperienceSnapshot): void {
    setExperience(next);
    setNetworkError(null);
  }

  async function resolveCheckoutCart(): Promise<Cart> {
    if (!productApiOrigin || !config.productSelection?.length) return config.cart;
    const response = await fetch(`${productApiOrigin}/checkout-cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: config.productSelection })
    });
    if (!response.ok) throw new Error(`Product cart request failed: ${response.status}`);
    const payload = productCartResponseSchema.parse(await response.json());
    setResolvedCart(payload.cart);
    return payload.cart;
  }

  function clearPersistedSession(): void {
    if (typeof window === "undefined") return;
    // P1: clear the namespaced key (and legacy key if still present).
    window.localStorage.removeItem(sessionStorageKey(config.merchantId));
    window.localStorage.removeItem("aacp_session_id");
  }

  function resetSessionAfterOrder(): void {
    clearPersistedSession();
    setSession(null);
  }

  async function startCheckout(): Promise<void> {
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    try {
      // P1: read the namespaced session id (with legacy migration).
      const savedSessionId = readPersistedSessionId(config.merchantId);
      const cart = await resolveCheckoutCart();
      const body =
        config.mode === "embed"
          ? { customer: config.customer, cart, shipping: config.shipping, session_id: savedSessionId || undefined }
          : {
              merchant_id: config.merchantId,
              customer: config.customer,
              cart,
              shipping: config.shipping,
              session_id: savedSessionId || undefined
            };
      const response = await checkoutJson<StartCheckoutResponse>(apiOrigin, paths.start, {
        ...embedOpts,
        body,
        schema: startCheckoutResponseSchema
      });
      setSession(response);
      syncExperience(response.experience);
      // P1: persist under namespaced keys to isolate tenants on the same origin.
      window.localStorage.setItem(globalUserStorageKey(config.merchantId), response.global_user_id);
      window.localStorage.setItem(sessionStorageKey(config.merchantId), response.session_id);
      setStartedEvent({ response, ts: Date.now() });
    } catch {
      setNetworkError(
        productApiOrigin && config.productSelection?.length
          ? "Não consegui carregar os produtos ou sincronizar esta sessão com a API agora. A conversa ficará bloqueada até a conexão voltar."
          : "Não consegui sincronizar esta sessão com a API agora. A conversa ficará bloqueada até a conexão voltar."
      );
      setStartErrorTs(Date.now());
    }
  }

  async function track(event: CheckoutEventName): Promise<void> {
    if (!session) return;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const body =
      config.mode === "embed"
        ? { session_id: session.session_id, event }
        : { merchant_id: config.merchantId, session_id: session.session_id, event };
    try {
      await checkoutJson<TrackEventResponse>(apiOrigin, paths.track, {
        ...embedOpts,
        body,
        schema: trackEventResponseSchema
      });
    } catch {
      // Telemetry is best effort and must never interrupt the checkout task.
    }
  }

  async function updateCart(items: UpdateCartItemInput[]): Promise<void> {
    if (!session || items.length === 0) return;
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    const body =
      config.mode === "embed"
        ? { session_id: session.session_id, items }
        : { merchant_id: config.merchantId, session_id: session.session_id, items };
    try {
      const response = await checkoutJson<UpdateCartResponse>(apiOrigin, paths.cart, {
        ...embedOpts,
        method: config.mode === "embed" ? "POST" : "PATCH",
        body,
        schema: updateCartResponseSchema
      });
      syncExperience(response.experience);
    } catch {
      setNetworkError("Não consegui atualizar o carrinho agora. Tente novamente.");
    }
  }

  function retryStartCheckout(): void {
    setNetworkError(null);
    void startCheckout();
  }

  const activeExperience = experience ?? fallbackExperience({ ...config, cart: resolvedCart });

  useEffect(() => {
    void startCheckout();
    const idleTimer = window.setTimeout(() => {
      void track("idle_30_seconds");
    }, 30_000);
    return () => { window.clearTimeout(idleTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    session,
    experience,
    activeExperience,
    resolvedCart,
    networkError,
    setNetworkError,
    apiOrigin,
    embedOpts,
    syncExperience,
    track,
    updateCart,
    retryStartCheckout,
    clearPersistedSession,
    resetSessionAfterOrder,
    startedEvent,
    startErrorTs,
  };
}

export type CheckoutSessionState = ReturnType<typeof useCheckoutSession>;
