"use client";
import { useContext, useEffect, useMemo, useRef } from "react";
import { MetaAdsAttributionClient } from "../lib/meta-ads-attribution";
import { conversationFetch } from "../lib/conversation-access";
import { MetaAdsConsentContext } from "./meta-ads-consent-context";
const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
export function MetaAdsAttribution({ conversationId, merchantId }: { conversationId?: string | null; merchantId?: string }) {
  const consent = useContext(MetaAdsConsentContext); const current = useRef({ consent, conversationId }); current.current = { consent, conversationId };
  const source = useRef("");
  const runner = useMemo(() => {
    if (!consent?.ready || !merchantId || consent.merchantId !== merchantId || typeof window === "undefined") return null;
    if (!source.current) source.current = window.location.href;
    return new MetaAdsAttributionClient({ merchantId, storeKey: consent.storeKey, pixelId: consent.pixelId, consentVersion: consent.version,
      consent: () => current.current.consent?.granted === true, sourceUrl: () => {if(new URL(window.location.href).searchParams.has('zyon_ad'))source.current=window.location.href;return source.current;}, cookies: () => document.cookie, now: () => Date.now(),
      storage: { getItem: key => sessionStorage.getItem(key), setItem: (key, value) => sessionStorage.setItem(key, value), removeItem: key => sessionStorage.removeItem(key) },
      send: async (id, action, body,metadata) => {
        const response = await conversationFetch(id, `${base}/storefront/conversations/${encodeURIComponent(id)}/meta-ads/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({...body,...(metadata?{idempotencyKey:metadata.idempotencyKey}:{})}), keepalive: action === "revoke", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error("attribution_unavailable"); return response.json();
      },
      pixel: (...args) => { const pixel = (window as Window & { fbq?: (...values: unknown[]) => void }).fbq; if (!pixel) throw new Error("pixel_unavailable"); pixel(...args); },
    });
  }, [merchantId, consent?.ready, consent?.storeKey, consent?.merchantId, consent?.pixelId, consent?.version]);
  useEffect(() => {
    if (!runner || !consent) return;
    return consent.registerRevoker(() => runner.revoke());
  }, [runner, consent?.registerRevoker]);
  useEffect(() => {
    if (!runner) return;
    const sync = () => { if (current.current.consent?.granted && current.current.conversationId) void runner.capture(current.current.conversationId); else void runner.revoke(); };
    const complete = (event: Event) => { void runner.purchase((event as CustomEvent).detail); };
    sync(); const timer = setInterval(sync, 10000); window.addEventListener("aacp:order-completed", complete);
    return () => { clearInterval(timer); window.removeEventListener("aacp:order-completed", complete); };
  }, [runner]);
  useEffect(() => { if (runner) { if (consent?.granted && conversationId) void runner.capture(conversationId); else void runner.revoke(); } }, [runner, conversationId, consent?.granted]);
  return null;
}
