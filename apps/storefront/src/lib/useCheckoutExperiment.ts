"use client";

import { useCallback, useRef, useState } from "react";

/**
 * ViewModel: Checkout Experiment
 *
 * Transparently captures experiment variant assignment from the conversation API.
 * Zero UX change — variant is an internal system concern used only for:
 *   1. Passing systemPrompt to the agent (backend does this)
 *   2. Attaching variantId to analytics tracking
 *
 * The storefront doesn't "know" about experiments — it just forwards what the API returns.
 */

export interface ExperimentAssignment {
  variantId: string;
  variantName: string;
  systemPrompt: string;
}

interface UseCheckoutExperimentReturn {
  /** Current experiment assignment (null = no active experiment / control) */
  experiment: ExperimentAssignment | null;
  /** Session-scoped conversation ID from the API */
  sessionConversationId: string | null;
  /** Called when conversation starts — extracts experiment from API response */
  captureFromConversationStart: (apiResponse: {
    conversation_id: string;
    experiment?: { variant_id: string; variant_name: string; system_prompt: string } | null;
  }) => void;
  /** Returns variantId for analytics tracking (or null if no experiment) */
  getTrackingVariantId: () => string | null;
  /** Store pre-fetched experiment greeting from LLM */
  setExperimentGreeting: (message: string, suggestedNext?: string[]) => void;
  /** Get stored experiment greeting (or null if not fetched yet) */
  getExperimentGreeting: () => { message: string; suggestedNext?: string[] } | null;
}

export function useCheckoutExperiment(): UseCheckoutExperimentReturn {
  const [experiment, setExperiment] = useState<ExperimentAssignment | null>(null);
  const [sessionConversationId, setSessionConversationId] = useState<string | null>(null);
  const assignedRef = useRef(false);
  const greetingRef = useRef<{ message: string; suggestedNext?: string[] } | null>(null);

  const captureFromConversationStart = useCallback(
    (apiResponse: {
      conversation_id: string;
      experiment?: { variant_id: string; variant_name: string; system_prompt: string } | null;
    }) => {
      setSessionConversationId(apiResponse.conversation_id);

      // Only assign once per session (immutable after first assignment)
      if (assignedRef.current) return;

      if (apiResponse.experiment) {
        assignedRef.current = true;
        setExperiment({
          variantId: apiResponse.experiment.variant_id,
          variantName: apiResponse.experiment.variant_name,
          systemPrompt: apiResponse.experiment.system_prompt,
        });

        // Persist variantId in sessionStorage for analytics
        try {
          sessionStorage.setItem("zyon_experiment_variant_id", apiResponse.experiment.variant_id);
          sessionStorage.setItem("zyon_experiment_variant_name", apiResponse.experiment.variant_name);
        } catch {
          /* sessionStorage unavailable — silent no-op */
        }
      }
    },
    [],
  );

  const getTrackingVariantId = useCallback(() => {
    return experiment?.variantId ?? null;
  }, [experiment]);

  const setExperimentGreeting = useCallback((message: string, suggestedNext?: string[]) => {
    greetingRef.current = { message, suggestedNext };
  }, []);

  const getExperimentGreeting = useCallback(() => {
    return greetingRef.current;
  }, []);

  return {
    experiment,
    sessionConversationId,
    captureFromConversationStart,
    getTrackingVariantId,
    setExperimentGreeting,
    getExperimentGreeting,
  };
}
