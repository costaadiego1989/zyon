import { useEffect, useState } from "react";

/**
 * Feature 4: LGPD Consent Banner Hook
 *
 * Manages consent state:
 * - Check localStorage for prior consent
 * - Show banner only once per buyer
 * - Call API when buyer accepts/rejects
 */

const CONSENT_STORAGE_KEY = "zyon_consent_asked";
const CONSENT_VERSION = "v1";

interface ConsentState {
  showBanner: boolean;
  onAccept: () => void;
  onReject: () => void;
  isLoading: boolean;
  error: string | null;
}

export function useConsent(
  sessionId: string,
  globalUserId: string,
  apiOrigin: string,
  embedToken?: string
): ConsentState {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize: check localStorage. If a prior decision failed to reach the
  // server (synced:false), re-sync it in the background — the banner stays
  // hidden (the buyer already decided), we just reconcile the source of truth.
  useEffect(() => {
    let stored: { optedIn?: boolean; synced?: boolean } | null = null;
    try {
      const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }

    if (!stored) {
      setShowBanner(true);
      return;
    }

    if (stored.synced === false && typeof stored.optedIn === "boolean" && sessionId && globalUserId) {
      // Fire-and-forget re-sync; failure just leaves synced:false for next load.
      void recordConsent(stored.optedIn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, globalUserId]);

  async function recordConsent(optedIn: boolean): Promise<void> {
    setIsLoading(true);
    setError(null);

    // Optimistic local cache FIRST: the buyer's decision is honored immediately
    // and the banner never re-appears, even if the network call fails. The server
    // is the source of truth (auditable, cross-device); localStorage is the UX
    // mirror. `synced` tracks whether the server already has it.
    const writeLocal = (synced: boolean) => {
      try {
        localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
          version: CONSENT_VERSION,
          optedIn,
          synced,
          timestamp: new Date().toISOString(),
        }));
      } catch {
        // localStorage unavailable (private mode) — non-fatal; server call still runs.
      }
    };

    writeLocal(false);
    setShowBanner(false);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (embedToken?.trim()) {
        headers["Authorization"] = `Bearer ${embedToken.trim()}`;
      }

      const response = await fetch(`${apiOrigin}/embed/checkout/consent`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_id: sessionId,
          global_user_id: globalUserId,
          opted_in: optedIn,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      // Server confirmed — mark as synced.
      writeLocal(true);
    } catch (err) {
      // Local decision stands (synced:false). A later load can re-sync.
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setIsLoading(false);
    }
  }

  return {
    showBanner,
    onAccept: () => recordConsent(true),
    onReject: () => recordConsent(false),
    isLoading,
    error,
  };
}
