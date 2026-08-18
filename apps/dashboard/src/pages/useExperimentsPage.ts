import { useEffect, useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { showToast } from "../components/Toast.js";
import type { MerchantProfile } from "../api-client.js";

export interface Variant {
  id: string;
  name: string;
  description?: string;
}

export interface Experiment {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "completed" | "archived";
  variants: Variant[];
  control_variant_id: string;
  winner_variant_id?: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  sample_size: number;
}

export interface ExperimentMetrics {
  experiment_id: string;
  variant_id: string;
  conversions: number;
  total_visitors: number;
  conversion_rate: number;
  avg_order_value?: number;
  revenue?: number;
}

export interface ExperimentResults {
  experiment_id: string;
  created_at: string;
  winner_variant_id?: string;
  confidence_level: number; // 0-100
  metrics: ExperimentMetrics[];
}

export interface ExperimentForm {
  name: string;
  description?: string;
  variants: Array<{ name: string; description?: string }>;
  sample_size: number;
}

const DEFAULT_FORM: ExperimentForm = {
  name: "",
  description: "",
  variants: [
    { name: "Control", description: "" },
    { name: "Variant A", description: "" },
  ],
  sample_size: 100,
};

export function validateExperimentForm(form: ExperimentForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Nome é obrigatório";
  if (form.name.length > 255) errors.name = "Máximo 255 caracteres";
  if (form.variants.length < 2) errors.variants = "Mínimo 2 variantes";
  if (form.variants.length > 10) errors.variants = "Máximo 10 variantes";
  if (form.variants.some((v) => !v.name.trim())) errors.variants = "Todas as variantes precisam de um nome";
  if (form.sample_size < 10 || form.sample_size > 1000000) errors.sample_size = "Entre 10 e 1.000.000";
  return errors;
}

export function useExperimentsPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // List page state
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState<Experiment["status"] | "all">("all");
  const [sortBy, setSortBy] = useState<"name" | "created" | "status">("created");

  // Detail page state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [selectedResults, setSelectedResults] = useState<ExperimentResults | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);

  // Create/edit state
  const [form, setForm] = useState<ExperimentForm>(DEFAULT_FORM);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);

  const errors = useMemo(() => validateExperimentForm(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  // Filtered and sorted experiments
  const filteredExperiments = useMemo(() => {
    let result = experiments;
    if (filterStatus !== "all") {
      result = result.filter((e) => e.status === filterStatus);
    }
    if (searchText) {
      const search = searchText.toLowerCase();
      result = result.filter((e) => e.name.toLowerCase().includes(search));
    }
    result.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "status") return a.status.localeCompare(b.status);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return result;
  }, [experiments, searchText, filterStatus, sortBy]);

  // Load experiments on mount
  useEffect(() => {
    if (!props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = (await api.getExperiments?.()) as Experiment[] | undefined;
        if (cancelled) return;
        setExperiments(data ?? []);
      } catch (e) {
        if (!cancelled) {
          showToast("error", e instanceof Error ? e.message : "Erro ao carregar experimentos");
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

  // Load results when selecting experiment
  useEffect(() => {
    if (!selectedId) {
      setSelectedExperiment(null);
      setSelectedResults(null);
      return;
    }
    const exp = experiments.find((e) => e.id === selectedId);
    setSelectedExperiment(exp ?? null);

    if (!exp) return;
    let cancelled = false;
    (async () => {
      setResultsLoading(true);
      try {
        const results = (await api.getExperimentResults?.(selectedId)) as
          | ExperimentResults
          | undefined;
        if (cancelled) return;
        setSelectedResults(results ?? null);
      } catch (e) {
        if (!cancelled) {
          showToast("error", e instanceof Error ? e.message : "Erro ao carregar resultados");
        }
      } finally {
        if (!cancelled) {
          setResultsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, experiments, api]);

  function patch(p: Partial<ExperimentForm>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  function addVariant() {
    setForm((prev) => ({
      ...prev,
      variants: [...prev.variants, { name: `Variant ${String.fromCharCode(65 + prev.variants.length)}` }],
    }));
  }

  function removeVariant(idx: number) {
    if (form.variants.length <= 2) {
      showToast("error", "Mínimo 2 variantes");
      return;
    }
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.filter((_, i) => i !== idx),
    }));
  }

  function updateVariant(idx: number, updates: Partial<Variant>) {
    setForm((prev) => ({
      ...prev,
      variants: prev.variants.map((v, i) => (i === idx ? { ...v, ...updates } : v)),
    }));
  }

  async function handleCreateExperiment() {
    if (hasErrors) {
      showToast("error", "Corrija os erros antes de criar");
      return;
    }
    setSaving(true);
    try {
      const newExp = (await api.createExperiment?.(form)) as Experiment | undefined;
      if (newExp) {
        setExperiments((prev) => [newExp, ...prev]);
        setForm(DEFAULT_FORM);
        setFormMode(null);
        showToast("success", "Experimento criado com sucesso");
      }
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao criar experimento");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartExperiment(experimentId: string) {
    setSaving(true);
    try {
      const updated = (await api.startExperiment?.(experimentId)) as Experiment | undefined;
      if (updated) {
        setExperiments((prev) => prev.map((e) => (e.id === experimentId ? updated : e)));
        if (selectedId === experimentId) {
          setSelectedExperiment(updated);
        }
        showToast("success", "Experimento iniciado");
      }
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao iniciar experimento");
    } finally {
      setSaving(false);
    }
  }

  async function handleStopExperiment(experimentId: string) {
    setSaving(true);
    try {
      const updated = (await api.stopExperiment?.(experimentId)) as Experiment | undefined;
      if (updated) {
        setExperiments((prev) => prev.map((e) => (e.id === experimentId ? updated : e)));
        if (selectedId === experimentId) {
          setSelectedExperiment(updated);
        }
        showToast("success", "Experimento interrompido");
      }
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao parar experimento");
    } finally {
      setSaving(false);
    }
  }

  async function handlePromoteVariant(experimentId: string, variantId: string) {
    if (!selectedResults || selectedResults.confidence_level < 95) {
      showToast("error", "Confiança insuficiente (<95%) para promover");
      return;
    }
    setSaving(true);
    try {
      await api.promoteExperimentVariant?.(experimentId, variantId);
      const updated = (await api.getExperiment?.(experimentId)) as Experiment | undefined;
      if (updated) {
        setExperiments((prev) => prev.map((e) => (e.id === experimentId ? updated : e)));
        if (selectedId === experimentId) {
          setSelectedExperiment(updated);
        }
      }
      showToast("success", "Variante promovida com sucesso");
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao promover variante");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveExperiment(experimentId: string) {
    setSaving(true);
    try {
      const updated = (await api.archiveExperiment?.(experimentId)) as Experiment | undefined;
      if (updated) {
        setExperiments((prev) => prev.map((e) => (e.id === experimentId ? updated : e)));
        if (selectedId === experimentId) {
          setSelectedId(null);
        }
        showToast("success", "Experimento arquivado");
      }
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao arquivar experimento");
    } finally {
      setSaving(false);
    }
  }

  function openCreateForm() {
    setForm(DEFAULT_FORM);
    setFormMode("create");
  }

  function closeForm() {
    setFormMode(null);
  }

  return {
    // List
    experiments: filteredExperiments,
    searchText,
    setSearchText,
    filterStatus,
    setFilterStatus,
    sortBy,
    setSortBy,
    loading,
    loaded,

    // Detail
    selectedId,
    setSelectedId,
    selectedExperiment,
    selectedResults,
    resultsLoading,

    // Form
    form,
    patch,
    addVariant,
    removeVariant,
    updateVariant,
    errors,
    hasErrors,
    saving,
    formMode,
    openCreateForm,
    closeForm,
    handleCreateExperiment,

    // Actions
    handleStartExperiment,
    handleStopExperiment,
    handlePromoteVariant,
    handleArchiveExperiment,
  };
}
