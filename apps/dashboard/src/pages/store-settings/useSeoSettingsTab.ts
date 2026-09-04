import { useCallback, useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { SeoSettings, GtmSettings, GenerateSeoSuggestionsResponse, SeoTone } from "@zyon/shared-types";

export interface SeoGtmTabState {
  seo: SeoSettings;
  gtm: GtmSettings;
  slug: string;
  loading: boolean;
  saving: boolean;
  generatingAi: boolean;
  showGeneratorModal: boolean;
  suggestions: GenerateSeoSuggestionsResponse | null;
  errors: Record<string, string>;
  expandedSections: { og: boolean; pixels: boolean };
}

const EMPTY_SEO: SeoSettings = {};
const EMPTY_GTM: GtmSettings = { dataLayerEnabled: true };

export function useSeoSettingsTab() {
  const api = useApi();

  const [state, setState] = useState<SeoGtmTabState>({
    seo: EMPTY_SEO,
    gtm: EMPTY_GTM,
    slug: "",
    loading: true,
    saving: false,
    generatingAi: false,
    showGeneratorModal: false,
    suggestions: null,
    errors: {},
    expandedSections: { og: false, pixels: false },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [seoResult, storeResult] = await Promise.all([
          api.getSeoSettings(),
          api.getStoreSettings(),
        ]);
        if (cancelled) return;
        setState((p) => ({
          ...p,
          seo: seoResult.seo ?? EMPTY_SEO,
          gtm: seoResult.gtm ?? EMPTY_GTM,
          slug: (storeResult as any)?.slug ?? "",
          loading: false,
        }));
      } catch {
        if (!cancelled) setState((p) => ({ ...p, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const setSeo = useCallback((partial: Partial<SeoSettings>) => {
    setState((p) => {
      const next = { ...p.seo, ...partial };
      const errors = validateSeo(next);
      return { ...p, seo: next, errors };
    });
  }, []);

  const setGtm = useCallback((partial: Partial<GtmSettings>) => {
    setState((p) => {
      const next = { ...p.gtm, ...partial };
      const errors = validateGtm(next);
      return { ...p, gtm: next, errors: { ...p.errors, ...errors } };
    });
  }, []);

  const setSlug = useCallback((slug: string) => {
    setState((p) => ({ ...p, slug }));
  }, []);

  const handleSave = useCallback(async () => {
    const seoErrors = validateSeo(state.seo);
    const gtmErrors = validateGtm(state.gtm);
    const allErrors = { ...seoErrors, ...gtmErrors };
    if (Object.keys(allErrors).length > 0) {
      setState((p) => ({ ...p, errors: allErrors }));
      showToast("error", "Corrija os erros antes de salvar");
      return;
    }

    setState((p) => ({ ...p, saving: true }));
    try {
      await Promise.all([
        api.putSeoSettings({ seo: state.seo, gtm: state.gtm }),
        api.putStoreSettings({ slug: state.slug }),
      ]);
      setState((p) => ({ ...p, saving: false }));
      showToast("success", "Configurações de SEO salvas com sucesso");
    } catch (e) {
      setState((p) => ({ ...p, saving: false }));
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar SEO");
    }
  }, [state.seo, state.gtm, state.slug, api]);

  const handleGenerate = useCallback(async (prompt: string, tone: SeoTone, storeCategory?: string) => {
    setState((p) => ({ ...p, generatingAi: true }));
    try {
      const suggestions = await api.generateSeoSuggestions({ prompt, tone, storeCategory });
      setState((p) => ({ ...p, generatingAi: false, suggestions }));
    } catch (e) {
      setState((p) => ({ ...p, generatingAi: false }));
      showToast("error", e instanceof Error ? e.message : "Erro ao gerar sugestões");
    }
  }, [api]);

  const handleApplySuggestion = useCallback((titleIdx: number, descIdx: number, keywords: string[]) => {
    setState((p) => {
      const title = p.suggestions?.titles[titleIdx] ?? p.seo.title;
      const description = p.suggestions?.descriptions[descIdx] ?? p.seo.description;
      return {
        ...p,
        seo: { ...p.seo, title, description, keywords },
        showGeneratorModal: false,
        suggestions: null,
      };
    });
  }, []);

  const openGeneratorModal = useCallback(() => setState((p) => ({ ...p, showGeneratorModal: true, suggestions: null })), []);
  const closeGeneratorModal = useCallback(() => setState((p) => ({ ...p, showGeneratorModal: false, suggestions: null })), []);
  const toggleSection = useCallback((section: "og" | "pixels") => setState((p) => ({ ...p, expandedSections: { ...p.expandedSections, [section]: !p.expandedSections[section] } })), []);

  return {
    state,
    setSeo,
    setGtm,
    setSlug,
    handleSave,
    handleGenerate,
    handleApplySuggestion,
    openGeneratorModal,
    closeGeneratorModal,
    toggleSection,
  };
}

function validateSeo(seo: SeoSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  if (seo.title && seo.title.length > 70) errors.seoTitle = "Máximo 70 caracteres";
  if (seo.description && seo.description.length > 160) errors.seoDescription = "Máximo 160 caracteres";
  if (seo.ogTitle && seo.ogTitle.length > 70) errors.ogTitle = "Máximo 70 caracteres";
  if (seo.ogDescription && seo.ogDescription.length > 160) errors.ogDescription = "Máximo 160 caracteres";
  if (seo.keywords && seo.keywords.length > 10) errors.keywords = "Máximo 10 palavras-chave";
  return errors;
}

function validateGtm(gtm: GtmSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  if (gtm.gtmId && !/^GTM-[A-Z0-9]+$/i.test(gtm.gtmId)) errors.gtmId = "Formato: GTM-XXXXXX";
  if (gtm.gaTrackingId && !/^G-[A-Z0-9]+$/i.test(gtm.gaTrackingId)) errors.gaTrackingId = "Formato: G-XXXXXX";
  return errors;
}
