import { useEffect, useState } from "react";
import type { CheckoutSettings, CheckoutTriggerName } from "@zyon/shared-types";
import {
  DashboardHttpError,
  type MerchantProfile as MerchantMeProfile,
} from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { useErrorReporter } from "../../hooks/useErrorReporter.js";
import { showToast } from "../../components/Toast.js";
import type { Draft, AdvancedRule } from "./lib/draft.js";
import { settingsToDraft, draftChangesToPatch, draftsEqual, DEFAULT_DRAFT } from "./lib/draft.js";
import { validate, type ValidationErrors } from "./lib/validation.js";

function errText(e: unknown): string {
  if (e instanceof DashboardHttpError) {
    if (e.status === 412) {
      return "As configurações foram alteradas desde a última leitura. Recarregue-as, revise e tente salvar novamente.";
    }
    return "Não foi possível concluir a solicitação. Tente novamente.";
  }
  return "Não foi possível concluir a solicitação. Tente novamente.";
}

export interface CheckoutSettingsViewModel {
  settings: CheckoutSettings | null;
  draft: Draft | null;
  busy: boolean;
  message: { text: string; kind: "info" | "error" } | null;
  activeTab: "triggers" | "discounts" | "rules";
  dirty: boolean;
  reloadRequired: boolean;
  errors: ValidationErrors;
  editingRule: AdvancedRule | null;
  editorOpen: boolean;
  save: () => void;
  load: () => void;
  restoreDefaults: () => void;
  discardChanges: () => void;
  patchDraft: (partial: Partial<Draft>) => void;
  patchTrigger: (trigger: CheckoutTriggerName, partial: Partial<{ enabled: boolean; message: string; cooldownSeconds: number; couponCode: string }>) => void;
  setActiveTab: (tab: "triggers" | "discounts" | "rules") => void;
  openRuleEditor: (rule: AdvancedRule | null) => void;
  closeRuleEditor: () => void;
  addRule: (rule: AdvancedRule) => void;
  updateRule: (id: string, rule: AdvancedRule) => void;
  deleteRule: (id: string) => void;
  toggleRule: (id: string, enabled: boolean) => void;
  reorderRules: (rules: AdvancedRule[]) => void;
}

export function useCheckoutSettingsPage(props: {
  me: MerchantMeProfile | null;
}): CheckoutSettingsViewModel {
  const api = useApi();
  const { reportError } = useErrorReporter();

  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [activeTab, setActiveTab] = useState<"triggers" | "discounts" | "rules">("triggers");
  const [editingRule, setEditingRule] = useState<AdvancedRule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    if (!props.me) {
      setSettings(null);
      setDraft(null);
      setSavedDraft(null);
      setMessage(null);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.me]);

  async function load() {
    setBusy(true);
    try {
      const s = await api.getCheckoutSettings();
      const d = settingsToDraft(s);
      setSettings(s);
      setDraft(d);
      setSavedDraft(d);
      setMessage(null);
      setReloadRequired(false);
    } catch (e) {
      setSettings(null);
      setMessage({ text: `Erro ao carregar: ${errText(e)}`, kind: "error" });
      reportError({ source: "checkout-settings.load", error: e, severity: "warning" });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft || busy || reloadRequired || !settings) return;
    const errs = validate(draft);
    if (Object.keys(errs).length > 0) {
      setMessage({ text: "Corrija os erros antes de salvar.", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const s = await api.patchCheckoutSettings(draftChangesToPatch(draft, settings));
      const d = settingsToDraft(s);
      setSettings(s);
      setDraft(d);
      setSavedDraft(d);
      setMessage(null);
      showToast("success", "Configurações salvas com sucesso");
    } catch (e) {
      const conflict = e instanceof DashboardHttpError && e.status === 412;
      setMessage({ text: `Erro ao salvar: ${errText(e)}`, kind: "error" });
      setReloadRequired(conflict);
      reportError({ source: "checkout-settings.save", error: e, severity: "warning" });
    } finally {
      setBusy(false);
    }
  }

  function restoreDefaults() {
    setDraft({ ...savedDraft, ...DEFAULT_DRAFT,
      // Presentation belongs to the store; this page cannot change hidden settings.
      mode: savedDraft?.mode ?? DEFAULT_DRAFT.mode,
      openWidgetOnTrigger: savedDraft?.openWidgetOnTrigger ?? DEFAULT_DRAFT.openWidgetOnTrigger,
      startMinimized: savedDraft?.startMinimized ?? DEFAULT_DRAFT.startMinimized,
      position: savedDraft?.position ?? DEFAULT_DRAFT.position,
      initialDelaySeconds: savedDraft?.initialDelaySeconds ?? DEFAULT_DRAFT.initialDelaySeconds,
      fabColor: savedDraft?.fabColor ?? DEFAULT_DRAFT.fabColor,
      inviteText: savedDraft?.inviteText ?? DEFAULT_DRAFT.inviteText,
      showCartBadge: savedDraft?.showCartBadge ?? DEFAULT_DRAFT.showCartBadge,
      checkoutReturnUrl: savedDraft?.checkoutReturnUrl ?? DEFAULT_DRAFT.checkoutReturnUrl,
      triggers: { ...DEFAULT_DRAFT.triggers } });
    setMessage({
      text: "Valores padrão carregados. Revise e salve para aplicar.",
      kind: "info",
    });
  }

  function discardChanges() {
    if (!savedDraft) return;
    setDraft({ ...savedDraft, triggers: { ...savedDraft.triggers } });
    setMessage(null);
  }

  function patchDraft(partial: Partial<Draft>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function patchTrigger(
    trigger: CheckoutTriggerName,
    partial: Partial<{ enabled: boolean; message: string; cooldownSeconds: number; couponCode: string }>
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        triggers: {
          ...prev.triggers,
          [trigger]: { ...prev.triggers[trigger], ...partial },
        },
      };
    });
  }

  function openRuleEditor(rule: AdvancedRule | null) {
    setEditingRule(rule);
    setEditorOpen(true);
  }

  function closeRuleEditor() {
    setEditingRule(null);
    setEditorOpen(false);
  }

  function addRule(rule: AdvancedRule) {
    setDraft((prev) => {
      if (!prev) return prev;
      const newRule: AdvancedRule = {
        ...rule,
        id: crypto.randomUUID(),
        priority: prev.advancedRules.length + 1,
      };
      return { ...prev, advancedRules: [...prev.advancedRules, newRule] };
    });
    closeRuleEditor();
  }

  function updateRule(id: string, rule: AdvancedRule) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        advancedRules: prev.advancedRules.map((r) => (r.id === id ? { ...rule, id } : r)),
      };
    });
    closeRuleEditor();
  }

  function deleteRule(id: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const filtered = prev.advancedRules.filter((r) => r.id !== id);
      return {
        ...prev,
        advancedRules: filtered.map((r, i) => ({ ...r, priority: i + 1 })),
      };
    });
  }

  function toggleRule(id: string, enabled: boolean) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        advancedRules: prev.advancedRules.map((r) =>
          r.id === id ? { ...r, enabled } : r
        ),
      };
    });
  }

  function reorderRules(rules: AdvancedRule[]) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        advancedRules: rules.map((r, i) => ({ ...r, priority: i + 1 })),
      };
    });
  }

  const dirty = draft && savedDraft ? !draftsEqual(draft, savedDraft) : false;

  // Unsaved changes guard
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const errors = draft ? validate(draft) : {};

  return {
    settings,
    draft,
    busy,
    message,
    activeTab,
    dirty,
    reloadRequired,
    errors,
    editingRule,
    editorOpen,
    save: () => void save(),
    load: () => void load(),
    restoreDefaults,
    discardChanges,
    patchDraft,
    patchTrigger,
    setActiveTab,
    openRuleEditor,
    closeRuleEditor,
    addRule,
    updateRule,
    deleteRule,
    toggleRule,
    reorderRules,
  };
}
