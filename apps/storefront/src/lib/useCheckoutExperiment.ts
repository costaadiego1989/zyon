"use client";

import { useCallback, useRef, useState } from "react";

export interface ExperimentAssignment {
  variantId: string;
  variantName: string;
  systemPrompt: string;
}
interface UseCheckoutExperimentReturn {
  experiment: ExperimentAssignment | null;
  sessionConversationId: string | null;
  captureFromConversationStart: (apiResponse: {
    conversation_id: string;
    experiment?: { variant_id: string; variant_name: string; system_prompt: string } | null;
  }) => void;
  getTrackingVariantId: () => string | null;
  setExperimentGreeting: (message: string, suggestedNext?: string[]) => void;
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
      if (assignedRef.current) return;
      if (apiResponse.experiment) {
        assignedRef.current = true;
        setExperiment({
          variantId: apiResponse.experiment.variant_id,
          variantName: apiResponse.experiment.variant_name,
          systemPrompt: apiResponse.experiment.system_prompt,
        });
        
        try {
          sessionStorage.setItem("zyon_experiment_variant_id", apiResponse.experiment.variant_id);
          sessionStorage.setItem("zyon_experiment_variant_name", apiResponse.experiment.variant_name);
        } catch {
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
