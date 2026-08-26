import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type {
  MerchantPolicyResponse,
  KnowledgeStatusResponse,
} from "../../api/endpoints/knowledge.js";

export interface PolicyForm {
  returns: string;
  shipping: string;
  warranty: string;
  payment: string;
  general: string;
}

const EMPTY_FORM: PolicyForm = {
  returns: "",
  shipping: "",
  warranty: "",
  payment: "",
  general: "",
};

function toForm(policy: MerchantPolicyResponse | null): PolicyForm {
  return {
    returns: policy?.returns ?? "",
    shipping: policy?.shipping ?? "",
    warranty: policy?.warranty ?? "",
    payment: policy?.payment ?? "",
    general: policy?.general ?? "",
  };
}

export function useKnowledgePage() {
  const api = useApi();

  const [form, setForm] = useState<PolicyForm>(EMPTY_FORM);
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [policy, statusData] = await Promise.all([
        api.getKnowledgePolicies(),
        api.getKnowledgeStatus(),
      ]);
      setForm(toForm(policy));
      setStatus(statusData);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const setField = useCallback((field: keyof PolicyForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const savePolicies = useCallback(async () => {
    setSaving(true);
    setIndexing(false);
    try {
      await api.putKnowledgePolicies({
        returns: form.returns,
        shipping: form.shipping,
        warranty: form.warranty,
        payment: form.payment,
        general: form.general,
      });
      showToast("Políticas salvas", "success");
      setIndexing(true);
      // Refresh status after indexing kicks off
      try {
        const statusData = await api.getKnowledgeStatus();
        setStatus(statusData);
      } catch {
        // non-fatal
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }, [api, form]);

  const reindexAll = useCallback(async () => {
    setReindexing(true);
    try {
      await api.postKnowledgeReindex();
      showToast("Reindexação iniciada", "success");
      const statusData = await api.getKnowledgeStatus();
      setStatus(statusData);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Falha ao reindexar", "error");
    } finally {
      setReindexing(false);
    }
  }, [api]);

  return {
    form,
    status,
    loading,
    saving,
    indexing,
    reindexing,
    setField,
    savePolicies,
    reindexAll,
    refresh: fetchAll,
  };
}
