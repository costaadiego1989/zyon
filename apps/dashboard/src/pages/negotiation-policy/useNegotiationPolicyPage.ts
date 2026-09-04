import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";
import type { NegotiationPolicy as ApiNegotiationPolicy, NegotiationPolicyResponse } from "../../api/types.js";

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

function apiToLocal(api: ApiNegotiationPolicy): NegotiationPolicy {
  return {
    negotiation_enabled: api.enabled,
    min_discount_percent: api.global.minOfferDiscountPercent,
    max_discount_percent: api.global.maxDiscountPercent,
  };
}

function localToApi(local: NegotiationPolicy, existing?: ApiNegotiationPolicy): ApiNegotiationPolicy {
  return {
    enabled: local.negotiation_enabled,
    global: {
      minOfferDiscountPercent: local.min_discount_percent,
      maxDiscountPercent: local.max_discount_percent,
    },
    categories: existing?.categories,
    items: existing?.items,
    maxRounds: existing?.maxRounds ?? 3,
    maxAiCostCents: existing?.maxAiCostCents,
    estimatedCostPerAiCallCents: existing?.estimatedCostPerAiCallCents ?? 5,
  };
}

const DEFAULT_POLICY: NegotiationPolicy = {
  negotiation_enabled: false,
  min_discount_percent: 5,
  max_discount_percent: 25,
};

export function useNegotiationPolicyPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [attempts, setAttempts] = useState<NegotiationAttempt[]>([]);
  const [policy, setPolicy] = useState<NegotiationPolicy>(DEFAULT_POLICY);
  const [rawApiPolicy, setRawApiPolicy] = useState<ApiNegotiationPolicy | undefined>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isEditingPolicy, setIsEditingPolicy] = useState(false);
  const [tempPolicy, setTempPolicy] = useState<NegotiationPolicy>(DEFAULT_POLICY);

  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res: NegotiationPolicyResponse = await api.getNegotiationPolicy();
        if (cancelled) return;
        const local = apiToLocal(res.policy);
        setRawApiPolicy(res.policy);
        setPolicy(local);
        setTempPolicy(local);
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
      const payload = localToApi(tempPolicy, rawApiPolicy);
      const res: NegotiationPolicyResponse = await api.putNegotiationPolicy(payload);
      const local = apiToLocal(res.policy);
      setRawApiPolicy(res.policy);
      setPolicy(local);
      setTempPolicy(local);
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
