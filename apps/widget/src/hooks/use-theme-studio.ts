import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@zyon/shared-types";
import type { GlobalAuthSession } from "../lib/widget-schemas.js";
import {
  canUseThemeStudio,
  clearLocalThemeOverrides,
  isMerchantSession,
  mergeThemeLayers,
  persistMerchantTheme,
  readLocalThemeOverrides,
  THEME_PRESETS,
  writeLocalThemeOverrides,
  type ThemeStudioDraft
} from "../lib/theme-studio.js";

const AUTOSAVE_MS = 700;

export interface ThemeStudioState {
  visible: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  draft: ThemeStudioDraft;
  resolvedTheme: MerchantTheme;
  saving: boolean;
  status: string | null;
  error: string | null;
  canPersist: boolean;
  setField: <K extends keyof MerchantTheme>(key: K, value: MerchantTheme[K]) => void;
  applyPreset: (presetId: string) => void;
  resetDraft: () => void;
  saveLocal: () => void;
  saveRemote: () => Promise<void>;
  exportJson: () => void;
}

export function useThemeStudio(options: {
  merchantId: string;
  baseTheme: MerchantTheme;
  session: GlobalAuthSession | null;
  apiBaseUrl: string;
}): ThemeStudioState {
  const visible = canUseThemeStudio(options.session);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ThemeStudioDraft>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<ThemeStudioDraft>({});

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!visible) return;
    setDraft(readLocalThemeOverrides(options.merchantId));
  }, [options.merchantId, visible]);

  const resolvedTheme = useMemo(
    () => mergeThemeLayers(options.baseTheme, readLocalThemeOverrides(options.merchantId), draft),
    [draft, options.baseTheme, options.merchantId]
  );

  const canPersist = isMerchantSession(options.session);

  const persistDraft = useCallback(
    async (nextDraft: ThemeStudioDraft, source: "auto" | "manual" = "auto") => {
      writeLocalThemeOverrides(options.merchantId, nextDraft);
      if (!options.session || !canPersist) return;
      setSaving(true);
      setError(null);
      try {
        const next = mergeThemeLayers(options.baseTheme, {}, nextDraft);
        await persistMerchantTheme(options.apiBaseUrl, options.session, next);
        if (source === "manual") {
          setStatus("Tema publicado para o tenant.");
        } else {
          setStatus("Alterações salvas automaticamente.");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falha ao publicar tema.");
      } finally {
        setSaving(false);
      }
    },
    [canPersist, options.apiBaseUrl, options.baseTheme, options.merchantId, options.session]
  );

  const schedulePersist = useCallback(
    (nextDraft: ThemeStudioDraft) => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void persistDraft(nextDraft, "auto");
      }, AUTOSAVE_MS);
    },
    [persistDraft]
  );

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  const updateDraft = useCallback(
    (updater: (current: ThemeStudioDraft) => ThemeStudioDraft) => {
      setDraft((current) => {
        const next = updater(current);
        schedulePersist(next);
        return next;
      });
      setError(null);
    },
    [schedulePersist]
  );

  const setField = useCallback(
    <K extends keyof MerchantTheme>(key: K, value: MerchantTheme[K]) => {
      updateDraft((current) => ({ ...current, [key]: value }));
    },
    [updateDraft]
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = THEME_PRESETS.find((item) => item.id === presetId);
      if (!preset) return;
      updateDraft(() => ({ ...preset.theme }));
      setStatus(`Preset "${preset.label}" aplicado.`);
    },
    [updateDraft]
  );

  const resetDraft = useCallback(() => {
    clearLocalThemeOverrides(options.merchantId);
    setDraft({});
    setStatus("Tema restaurado para o padrão do tenant.");
    setError(null);
    if (options.session && canPersist) {
      void persistMerchantTheme(options.apiBaseUrl, options.session, options.baseTheme);
    }
  }, [canPersist, options.apiBaseUrl, options.baseTheme, options.merchantId, options.session]);

  const saveLocal = useCallback(() => {
    writeLocalThemeOverrides(options.merchantId, draftRef.current);
    setStatus("Tema salvo localmente neste navegador.");
    setError(null);
  }, [options.merchantId]);

  const saveRemote = useCallback(async () => {
    await persistDraft(draftRef.current, "manual");
  }, [persistDraft]);

  const exportJson = useCallback(() => {
    const payload = mergeThemeLayers(DEFAULT_MERCHANT_THEME, {}, draftRef.current);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aacp-theme-${options.merchantId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("JSON exportado.");
  }, [options.merchantId]);

  return {
    visible,
    open,
    setOpen,
    draft,
    resolvedTheme,
    saving,
    status,
    error,
    canPersist,
    setField,
    applyPreset,
    resetDraft,
    saveLocal,
    saveRemote,
    exportJson
  };
}
