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

  // Initialize: check localStorage
  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!stored) {
      setShowBanner(true);
    }
  }, []);

  async function recordConsent(optedIn: boolean): Promise<void> {
    setIsLoading(true);
    setError(null);

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

      // Record consent in localStorage
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
        version: CONSENT_VERSION,
        optedIn,
        timestamp: new Date().toISOString(),
      }));

      setShowBanner(false);
    } catch (err) {
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
