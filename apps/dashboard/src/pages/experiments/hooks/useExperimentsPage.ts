import { useEffect, useMemo, useState } from "react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import { DashboardHttpError } from "../../../api/http/error.js";
import type { MerchantProfile } from "../../../api-client.js";
import type { Experiment, ExperimentResults } from "../types.js";
import { useExperimentForm } from "./useExperimentForm.js";

export function useExperimentsPage(props: { me: MerchantProfile | null }) {
  const api = useApi();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [autoToggleBusy, setAutoToggleBusy] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState<Experiment["status"] | "all">("all");
  const [sortBy, setSortBy] = useState<"name" | "created" | "status">("created");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedExperiment, setSelectedExperiment] = useState<Experiment | null>(null);
  const [selectedResults, setSelectedResults] = useState<ExperimentResults | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);

  const formState = useExperimentForm();

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

  useEffect(() => {
    if (!props.me) return;
    let cancelled = false;
    (async () => {
      try {
        const rules = await api.getMerchantRules?.();
        if (cancelled || !rules) return;
        setAutoEnabled((rules as { autonomousEngineEnabled?: boolean }).autonomousEngineEnabled !== false);
      } catch (e) {
        reportError({ source: "experiments.loadAutoState", error: e });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, props.me]);

  async function handleToggleAuto(next: boolean) {
    const prev = autoEnabled;
    setAutoEnabled(next); // optimistic
    setAutoToggleBusy(true);
    try {
      await api.putMerchantRules?.({ autonomousEngineEnabled: next } as Record<string, unknown>);
      showToast("success", next ? "Testes automáticos ativados" : "Testes automáticos desativados");
    } catch (e) {
      setAutoEnabled(prev); // rollback
      reportError({ source: "experiments.toggleAuto", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao atualizar testes automáticos");
    } finally {
      setAutoToggleBusy(false);
    }
  }

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
      showToast("error", humanizeExperimentError(e));
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

  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  function requestArchive(experimentId: string) {
    setArchiveConfirmId(experimentId);
  }
  function cancelArchive() {
    setArchiveConfirmId(null);
  }
  async function confirmArchive() {
    const id = archiveConfirmId;
    setArchiveConfirmId(null);
    if (id) await handleArchiveExperiment(id);
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
      showToast("error", humanizeExperimentError(e));
    } finally {
      setSaving(false);
    }
  }

  const [generatingVariants, setGeneratingVariants] = useState(false);
  async function handleGenerateVariants() {
    const merchantId = props.me?.id;
    if (!merchantId) return;
    const name = formState.form.name.trim();
    if (name.length < 3) {
      showToast("error", "Dê um nome ao teste antes de gerar variantes com IA");
      return;
    }
    setGeneratingVariants(true);
    try {
      const goal = formState.form.description?.trim() || "";
      const notes = `Gere a INSTRUÇÃO (system prompt) para um agente de vendas de checkout seguir na variante DESAFIANTE de um teste A/B chamado "${name}". Objetivo do teste: ${goal || name}. Descreva o comportamento, tom e gatilhos do agente em 2-3 frases, texto puro, em português. Não repita o nome do teste.`;
      const result = await api.generateDescription?.(merchantId, {
        name,
        notes,
        type: "ab_test_variant",
      });
      const prompt = result?.description?.trim();
      if (!prompt) {
        showToast("error", "IA não retornou uma variante. Tente novamente.");
        return;
      }
      const controlIdx = 0;
      const challengerIdx = formState.form.variants.length > 1 ? 1 : 0;
      if (!formState.form.variants[controlIdx]?.description?.trim()) {
        formState.updateVariant(controlIdx, {
          description: "Mantém o comportamento atual do agente: consultivo, responde perguntas, oferece descontos apenas quando autorizado pelas regras.",
          is_control: true,
        });
      }
      formState.updateVariant(challengerIdx, { description: prompt, is_control: false });
      showToast("success", "Variante gerada com IA");
    } catch (e) {
      reportError({ source: "experiments.generateVariants", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao gerar variantes com IA");
    } finally {
      setGeneratingVariants(false);
    }
  }

  function humanizeExperimentError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    if (raw.includes("MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT")) {
      return "Você já tem um experimento em execução. Conclua ou pause-o antes de criar outro.";
    }
    if (raw.includes("INVALID_TRANSITION")) {
      return "Operação não permitida neste estado do experimento.";
    }
    if (e instanceof DashboardHttpError && e.status === 401) {
      return "Sessão expirada. Faça login novamente.";
    }
    if (e instanceof DashboardHttpError && e.status >= 500) {
      return "Erro no servidor. Tente novamente em alguns segundos.";
    }
    return raw || "Erro inesperado.";
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

    // Archive confirmation
    archiveConfirmId,
    requestArchive,
    cancelArchive,
    confirmArchive,

    // Auto-tests toggle (persisted in merchant rules)
    autoEnabled,
    autoToggleBusy,
    handleToggleAuto,

    // AI variant generation (real LLM)
    generatingVariants,
    handleGenerateVariants,
  };
}
