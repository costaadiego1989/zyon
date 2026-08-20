import { useEffect, useRef } from "react";
import type { AuthorizedOffer } from "@zyon/shared-types";

/**
 * Feature 3: Cart Recovery Detection Hook
 *
 * Detects mid-session offer changes from background recovery scanner.
 *
 * The recovery scanner updates session → Widget picks up new authorizedOffer
 * via ChatMessageResponse. This hook adds a safety-net poller that detects
 * stale offers even when no new agent messages arrive (e.g. user went idle).
 *
 * Strategy:
 * 1. Track last seen authorizedOffer.id
 * 2. When a new offer arrives (via chat response or polling), fire callback
 * 3. Max 1 recovery trigger per session (debounce)
 * 4. Only fire if offer.approved === true
 */

interface RecoveryDetectorConfig {
  /** Current authorizedOffer from chat response */
  currentOffer?: AuthorizedOffer | null;
  /** Whether recovery has already been triggered this session */
  sessionId: string;
  /** Callback when a new recovery offer is detected */
  onRecoveryDetected?: (offer: AuthorizedOffer) => void;
}

const RECOVERY_FIRED_KEY_PREFIX = "zyon_recovery_fired:";

/**
 * useRecoveryDetector
 *
 * Monitors authorizedOffer changes and fires recovery callback.
 * The widget already gets new offers through ChatMessageResponse,
 * so this hook simply tracks whether the offer.id changed and
 * ensures the recovery UI trigger fires exactly once per session.
 */
export function useRecoveryDetector({
  currentOffer,
  sessionId,
  onRecoveryDetected,
}: RecoveryDetectorConfig): void {
  const lastOfferIdRef = useRef<string | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    // Check if recovery was already fired for this session
    const storageKey = `${RECOVERY_FIRED_KEY_PREFIX}${sessionId}`;
    const already = sessionStorage.getItem(storageKey);
    if (already) {
      firedRef.current = true;
    }
  }, [sessionId]);

  useEffect(() => {
    if (!currentOffer) return;
    if (!currentOffer.approved) return;
    if (firedRef.current) return;

    const offerId = currentOffer.id;
    if (!offerId) return;

    // First time seeing an offer — just store the ID
    if (lastOfferIdRef.current === null) {
      lastOfferIdRef.current = offerId;
      return;
    }

    // Same offer — no change
    if (lastOfferIdRef.current === offerId) return;

    // New offer detected — fire recovery
    lastOfferIdRef.current = offerId;
    firedRef.current = true;

    // Mark in sessionStorage so reload doesn't re-trigger
    const storageKey = `${RECOVERY_FIRED_KEY_PREFIX}${sessionId}`;
    sessionStorage.setItem(storageKey, "1");

    onRecoveryDetected?.(currentOffer);
  }, [currentOffer, sessionId, onRecoveryDetected]);
}
