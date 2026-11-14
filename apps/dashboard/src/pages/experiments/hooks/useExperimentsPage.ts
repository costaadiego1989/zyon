import { useEffect, useMemo, useRef, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [resultsAttempt, setResultsAttempt] = useState(0);
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [autoError, setAutoError] = useState(false);
  const [autoAttempt, setAutoAttempt] = useState(0);
  const formBusy = useRef(false);
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
    let result = [...experiments];
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
      setLoadError(null);
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
          setLoadError("Não foi possível carregar os testes. Tente novamente.");
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
  }, [api, props.me, loadAttempt]);

  useEffect(() => {
    if (!props.me) return;
    let cancelled = false;
    (async () => {
      try {
        const rules = await api.getMerchantRules?.();
        if (cancelled || !rules) return;
        setAutoEnabled((rules as { autonomousEngineEnabled?: boolean }).autonomousEngineEnabled !== false);
        setAutoLoaded(true); setAutoError(false);
      } catch (e) {
        reportError({ source: "experiments.loadAutoState", error: e });
        if (!cancelled) { setAutoLoaded(false); setAutoError(true); }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, props.me, autoAttempt]);

  async function handleToggleAuto(next: boolean) {
    if (autoToggleBusy || !autoLoaded) return;
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
      setSelectedResults(null); setResultsError(null);
      try {
        const results = (await api.getExperimentResults?.(selectedId)) as
          | ExperimentResults
          | undefined;
        if (cancelled) return;
        setSelectedResults(results ?? null);
      } catch (e) {
        reportError({ source: "experiments.loadResults", error: e });
        if (!cancelled) {
          setResultsError("Não foi possível carregar os resultados deste teste.");
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
  }, [selectedId, experiments, api, resultsAttempt]);

  async function handleCreateExperiment() {
    if (formBusy.current) return;
    if (formState.hasErrors) {
      showToast("error", "Corrija os erros antes de criar");
      return;
    }
    formBusy.current = true; setFormError(null);
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
      setFormError(humanizeExperimentError(e) + " Seus dados foram mantidos.");
    } finally {
      formBusy.current = false; setSaving(false);
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
    setArchiveError(null);
    setArchiveConfirmId(experimentId);
  }
  function cancelArchive() {
    if (!saving) setArchiveConfirmId(null);
  }
  async function confirmArchive() {
    const id = archiveConfirmId;
    if (id && !saving && await handleArchiveExperiment(id)) setArchiveConfirmId(null);
  }

  async function handleArchiveExperiment(experimentId: string) {
    if (saving) return false;
    setArchiveError(null); setSaving(true);
    try {
      const updated = (await api.archiveExperiment?.(experimentId)) as Experiment | undefined;
      if (updated) {
        setExperiments((prev) => prev.map((e) => (e.id === experimentId ? updated : e)));
        if (selectedId === experimentId) {
          setSelectedId(null);
        }
        showToast("success", "Teste arquivado");
        return true;
      }
    } catch (e) {
      reportError({ source: "experiments.archive", error: e });
      setArchiveError(humanizeExperimentError(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const [generatingVariants, setGeneratingVariants] = useState(false);
  async function handleGenerateVariants() {
    if (formBusy.current) return;
    const merchantId = props.me?.id;
    if (!merchantId) return;
    const name = formState.form.name.trim();
    if (name.length < 3) {
      showToast("error", "Dê um nome ao teste antes de gerar variantes com IA");
      return;
    }
    formBusy.current = true; setFormError(null);
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
        setFormError("Não recebemos uma sugestão da IA. Tente novamente ou escreva a abordagem manualmente.");
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
      setFormError("Não foi possível gerar a abordagem. Seus textos foram mantidos. Tente novamente ou edite manualmente.");
    } finally {
      formBusy.current = false; setGeneratingVariants(false);
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
    allExperiments: experiments,
    loadError, formError, archiveError, resultsError, autoLoaded, autoError,
    reload: () => setLoadAttempt(v => v + 1),
    reloadResults: () => setResultsAttempt(v => v + 1),
    reloadAuto: () => setAutoAttempt(v => v + 1),
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
    openCreateForm: () => { setFormError(null); formState.openCreateForm(); },
    closeForm: () => { if (!formBusy.current) formState.closeForm(); },
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
