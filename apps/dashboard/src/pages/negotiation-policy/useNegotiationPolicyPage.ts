import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";

export interface NegotiationAttempt {
  id: string;
  session_id: string;
  discount_percent: number;
  scope: string;
  result: "accepted" | "rejected" | "pending";
  created_at: string;
}

export interface NegotiationPolicy {
  negotiation_enabled: boolean;
  min_discount_percent: number;
  max_discount_percent: number;
}

export function useNegotiationPolicyPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [attempts, setAttempts] = useState<NegotiationAttempt[]>([]);
  const [policy, setPolicy] = useState<NegotiationPolicy>({
    negotiation_enabled: false,
    min_discount_percent: 5,
    max_discount_percent: 25,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isEditingPolicy, setIsEditingPolicy] = useState(false);
  const [tempPolicy, setTempPolicy] = useState<NegotiationPolicy>({
    negotiation_enabled: false,
    min_discount_percent: 5,
    max_discount_percent: 25,
  });

  // Load data on mount
  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Mock API calls — replace with real endpoints
        const policyData = (await Promise.resolve({
          negotiation_enabled: false,
          min_discount_percent: 5,
          max_discount_percent: 25,
        })) as NegotiationPolicy | undefined;
        const attemptsData = (await Promise.resolve([])) as NegotiationAttempt[] | undefined;
        if (cancelled) return;
        setPolicy(policyData ?? { negotiation_enabled: false, min_discount_percent: 5, max_discount_percent: 25 });
        setTempPolicy(policyData ?? { negotiation_enabled: false, min_discount_percent: 5, max_discount_percent: 25 });
        setAttempts(attemptsData ?? []);
      } catch (e) {
        reportError({ source: "negotiation-policy.load", error: e });
        if (!cancelled) {
          showToast("error", e instanceof Error ? e.message : "Erro ao carregar política de negociação");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, props.me]);

  async function handleSavePolicy() {
    if (tempPolicy.min_discount_percent >= tempPolicy.max_discount_percent) {
      showToast("error", "Desconto mínimo deve ser menor que o máximo");
      return;
    }
    setSaving(true);
    try {
      // Mock API call — replace with real endpoint
      setPolicy(tempPolicy);
      setIsEditingPolicy(false);
      showToast("success", "Política de negociação atualizada");
    } catch (e) {
      reportError({ source: "negotiation-policy.save", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar política");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelPolicy() {
    setTempPolicy(policy);
    setIsEditingPolicy(false);
  }

  return {
    attempts,
    policy,
    loading,
    loaded,
    saving,
    isEditingPolicy,
    tempPolicy,
    setTempPolicy,
    setIsEditingPolicy,
    handleSavePolicy,
    handleCancelPolicy,
  };
}
