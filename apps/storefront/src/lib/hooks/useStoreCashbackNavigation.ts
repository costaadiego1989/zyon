"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiCall } from "../services/http";
import { storeCashbackEnabled } from "../cashback-navigation";

export function useStoreCashbackNavigation(merchantId?: string, merchantSlug?: string, initialEnabled = false) {
  const scope = JSON.stringify([merchantId, merchantSlug]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const version = useRef(0);
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState({ scope, enabled: initialEnabled === true && Boolean(merchantId && merchantSlug) });
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    const revision = ++version.current;
    request.current?.abort();
    if (!merchantId || !merchantSlug) {
      setState({ scope, enabled: false });
      setPending(false);
      return false;
    }
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setPending(true);
    try {
      const config = await apiCall<unknown>(`/storefront/${encodeURIComponent(merchantSlug)}/config`, {
        authRequired: false, cache: "no-store", signal: controller.signal,
      });
      if (version.current !== revision || currentScope.current !== scope) return false;
      const enabled = storeCashbackEnabled(config, merchantId);
      setState({ scope, enabled });
      return enabled;
    } catch {
      if (version.current === revision && currentScope.current === scope) setState({ scope, enabled: false });
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (version.current === revision) setPending(false);
    }
  }, [merchantId, merchantSlug, scope]);

  useEffect(() => {
    setState({ scope, enabled: initialEnabled === true && Boolean(merchantId && merchantSlug) });
    void refresh();
    const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      ++version.current;
      request.current?.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, scope, merchantId, merchantSlug, initialEnabled]);

  return { enabled: state.scope === scope && state.enabled, pending, refresh };
}
