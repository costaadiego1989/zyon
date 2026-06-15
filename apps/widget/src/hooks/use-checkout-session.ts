import { useEffect, useMemo, useRef, useState } from "react";
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
import { fallbackExperience } from "./checkout-view-model.js";

export interface SessionStartedEvent {
  response: StartCheckoutResponse;
  ts: number;
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
  const embedOpts = config.mode === "embed" ? { embedToken: config.embedSessionToken! } : {};

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
    window.localStorage.removeItem("aacp_session_id");
  }

  function resetSessionAfterOrder(): void {
    clearPersistedSession();
    setSession(null);
  }

  async function startCheckout(): Promise<void> {
    const paths = config.mode === "embed" ? CHECKOUT_EMBED_PATHS : CHECKOUT_LEGACY_PATHS;
    try {
      const savedSessionId = window.localStorage.getItem("aacp_session_id");
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
      window.localStorage.setItem("aacp_global_user_id", response.global_user_id);
      window.localStorage.setItem("aacp_session_id", response.session_id);
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
