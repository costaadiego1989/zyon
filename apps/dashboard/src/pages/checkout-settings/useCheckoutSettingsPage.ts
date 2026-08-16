import { useEffect, useState } from "react";
import type { CheckoutSettings, CheckoutTriggerName } from "@zyon/shared-types";
import {
  DashboardHttpError,
  type MerchantProfile as MerchantMeProfile,
} from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import type { Draft } from "./lib/draft.js";
import { settingsToDraft, draftToPatch, draftsEqual, DEFAULT_DRAFT } from "./lib/draft.js";
import { validate, type ValidationErrors } from "./lib/validation.js";

function errText(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 160);
  return e instanceof Error ? e.message : String(e);
}

export interface CheckoutSettingsViewModel {
  settings: CheckoutSettings | null;
  draft: Draft | null;
  busy: boolean;
  message: { text: string; kind: "info" | "error" } | null;
  activeTab: "behavior" | "triggers" | "discounts";
  dirty: boolean;
  errors: ValidationErrors;
  save: () => void;
  load: () => void;
  restoreDefaults: () => void;
  discardChanges: () => void;
  patchDraft: (partial: Partial<Draft>) => void;
  patchTrigger: (trigger: CheckoutTriggerName, partial: Partial<{ enabled: boolean }>) => void;
  setActiveTab: (tab: "behavior" | "triggers" | "discounts") => void;
}

export function useCheckoutSettingsPage(props: {
  me: MerchantMeProfile | null;
}): CheckoutSettingsViewModel {
  const api = useApi();

  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [activeTab, setActiveTab] = useState<"behavior" | "triggers" | "discounts">("behavior");

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
    } catch (e) {
      setSettings(null);
      setMessage({ text: `Erro ao carregar: ${errText(e)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const errs = validate(draft);
    if (Object.keys(errs).length > 0) {
      setMessage({ text: "Corrija os erros antes de salvar.", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const s = await api.patchCheckoutSettings(draftToPatch(draft));
      const d = settingsToDraft(s);
      setSettings(s);
      setDraft(d);
      setSavedDraft(d);
      setMessage({ text: "Salvo.", kind: "info" });
    } catch (e) {
      setMessage({ text: `Erro ao salvar: ${errText(e)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function restoreDefaults() {
    if (
      !window.confirm(
        "Voltar tudo para o padrão recomendado? Você ainda precisa salvar para aplicar."
      )
    )
      return;
    setDraft({ ...DEFAULT_DRAFT, triggers: { ...DEFAULT_DRAFT.triggers } });
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
    partial: Partial<{ enabled: boolean }>
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
    errors,
    save: () => void save(),
    load: () => void load(),
    restoreDefaults,
    discardChanges,
    patchDraft,
    patchTrigger,
    setActiveTab,
  };
}
