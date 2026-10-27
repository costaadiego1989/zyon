import { useEffect, useState, useCallback } from "react";
import type { EmbedSessionResponse, MerchantProfile } from "../api-client.js";

const PREVIEW_SCOPES = ["checkout:start", "checkout:chat", "checkout:track", "offers:apply"];
const PREVIEW_TTL_SECONDS = 900;

interface EmbedTokenApi {
  createEmbedSession(payload: {
    ttl_seconds?: number;
    allowed_origin?: string;
    scopes?: string[];
    cart_ref?: string;
  }): Promise<EmbedSessionResponse>;
}

interface UseEmbedTokenResult {
  token: string | null;
  busy: boolean;
  errorMsg: string | null;
  issueToken: () => Promise<void>;
}

/**
 * Hook to manage embed session token lifecycle.
 * Issues a token when the merchant profile becomes available and updates the caller on expiration.
 */
export function useEmbedToken(
  api: EmbedTokenApi | null | undefined,
  me: MerchantProfile | null,
  onTokenIssued?: (expiresAtUnix: number) => void
): UseEmbedTokenResult {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const issueToken = useCallback(async () => {
    if (!api || !me) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const session = await api.createEmbedSession({
        ttl_seconds: PREVIEW_TTL_SECONDS,
        allowed_origin: window.location.origin,
        scopes: PREVIEW_SCOPES,
      });
      setToken(session.embed_session_token);
      onTokenIssued?.(session.expires_at_unix);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg.slice(0, 200));
    } finally {
      setBusy(false);
    }
  }, [api, me, onTokenIssued]);

  useEffect(() => {
    void issueToken();
  }, [me?.id, issueToken]);

  return { token, busy, errorMsg, issueToken };
}
