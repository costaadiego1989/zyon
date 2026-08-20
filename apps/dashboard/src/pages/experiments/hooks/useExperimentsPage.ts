import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../../api-client.js";
import type { Experiment, ExperimentResults, ExperimentForm } from "../types.js";
import { useExperimentForm } from "./useExperimentForm.js";

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

  // Form
  const formState = useExperimentForm();

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
        // Auto-select first running experiment on initial load
        if (!selectedId && data && data.length > 0) {
          const running = data.find(e => e.status === "running");
          setSelectedId(running?.id ?? data[0].id);
        }
      } catch (e) {
        reportError({ source: "experiments.load", error: e });
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
        reportError({ source: "experiments.loadResults", error: e });
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

  async function handleCreateExperiment() {
    if (formState.hasErrors) {
      showToast("error", "Corrija os erros antes de criar");
      return;
    }
    setSaving(true);
    try {
      const newExp = (await api.createExperiment?.(formState.form)) as Experiment | undefined;
      if (newExp) {
        setExperiments((prev) => [newExp, ...prev]);
        formState.resetForm();
        showToast("success", "Experimento criado com sucesso");
      }
    } catch (e) {
      reportError({ source: "experiments.create", error: e });
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
      reportError({ source: "experiments.start", error: e });
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
      reportError({ source: "experiments.stop", error: e });
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
      reportError({ source: "experiments.promote", error: e });
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
      reportError({ source: "experiments.archive", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao arquivar experimento");
    } finally {
      setSaving(false);
    }
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

    // Form (spread form state for backward compat)
    form: formState.form,
    patch: formState.patch,
    addVariant: formState.addVariant,
    removeVariant: formState.removeVariant,
    updateVariant: formState.updateVariant,
    errors: formState.errors,
    hasErrors: formState.hasErrors,
    saving,
    formMode: formState.formMode,
    openCreateForm: formState.openCreateForm,
    closeForm: formState.closeForm,
    handleCreateExperiment,

    // Actions
    handleStartExperiment,
    handleStopExperiment,
    handlePromoteVariant,
    handleArchiveExperiment,
  };
}
