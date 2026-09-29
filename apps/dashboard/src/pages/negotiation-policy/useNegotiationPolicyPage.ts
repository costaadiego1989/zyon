import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../api-client.js";
import type {
  NegotiationPolicy as ApiNegotiationPolicy,
  NegotiationPolicyResponse,
} from "../../api/types.js";

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

function localToApi(
  local: NegotiationPolicy,
  existing?: ApiNegotiationPolicy
): ApiNegotiationPolicy {
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
  negotiation_enabled: true,
  min_discount_percent: 5,
  max_discount_percent: 10,
};

export function useNegotiationPolicyPage(props: {
  me: MerchantProfile | null;
}) {
  const api = useApi();
  const [policy, setPolicy] = useState<NegotiationPolicy>(DEFAULT_POLICY);
  const [rawApiPolicy, setRawApiPolicy] = useState<ApiNegotiationPolicy>();
  const [tempPolicy, setTempPolicy] =
    useState<NegotiationPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const reading = useRef(0),
    working = useRef(false);
  const reload = useCallback(async () => {
    if (!props.me || working.current) return;
    const request = ++reading.current;
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.getNegotiationPolicy();
      if (request !== reading.current) return;
      const local = apiToLocal(res.policy);
      setRawApiPolicy(res.policy);
      setPolicy(local);
      setTempPolicy(local);
    } catch (error) {
      reportError({ source: "negotiation-policy.load", error });
      if (request === reading.current)
        setLoadError(
          "Não foi possível consultar os limites. Tente novamente antes de editar."
        );
    } finally {
      if (request === reading.current) setLoading(false);
    }
  }, [api, props.me?.id]);
  useEffect(() => {
    void reload();
    return () => {
      reading.current++;
    };
  }, [reload]);

  async function handleSavePolicy(draft: NegotiationPolicy) {
    if (working.current || loading || loadError || !rawApiPolicy) return;
    if (
      ![draft.min_discount_percent, draft.max_discount_percent].every(
        Number.isFinite
      ) ||
      draft.min_discount_percent < 0 ||
      draft.max_discount_percent > 100 ||
      draft.min_discount_percent > draft.max_discount_percent
    ) {
      setSaveError("Confira a faixa de desconto antes de salvar.");
      return;
    }
    working.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const res: NegotiationPolicyResponse = await api.putNegotiationPolicy(
        localToApi(draft, rawApiPolicy)
      );
      const local = apiToLocal(res.policy);
      setRawApiPolicy(res.policy);
      setPolicy(local);
      setTempPolicy(local);
      showToast("success", "Limites de negociação salvos");
    } catch (error) {
      reportError({ source: "negotiation-policy.save", error });
      setSaveError(
        "Não foi possível salvar os limites. Suas alterações continuam no formulário."
      );
    } finally {
      working.current = false;
      setSaving(false);
    }
  }
  function handleCancelPolicy() {
    if (!working.current) {
      setTempPolicy(policy);
      setSaveError("");
    }
  }
  return {
    policy,
    loading,
    saving,
    tempPolicy,
    setTempPolicy,
    loadError,
    saveError,
    reload,
    handleSavePolicy,
    handleCancelPolicy,
  };
}
