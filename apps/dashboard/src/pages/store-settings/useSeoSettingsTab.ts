import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { SeoSettings, GtmSettings, GenerateSeoSuggestionsResponse, SeoTone } from "@zyon/shared-types";

export interface SeoGtmTabState {
  seo: SeoSettings;
  gtm: GtmSettings;
  slug: string;
  loading: boolean;
  loadError: string | null;
  actionError: string | null;
  saveMessage: string | null;
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
  const working = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);

  const [state, setState] = useState<SeoGtmTabState>({
    seo: EMPTY_SEO,
    gtm: EMPTY_GTM,
    slug: "",
    loading: true,
    loadError: null,
    actionError: null,
    saveMessage: null,
    saving: false,
    generatingAi: false,
    showGeneratorModal: false,
    suggestions: null,
    errors: {},
    expandedSections: { og: false, pixels: false },
  });

  useEffect(() => {
    let cancelled = false;
    setState(p => ({ ...p, loading: true, loadError: null }));
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
        if (!cancelled) setState((p) => ({ ...p, loading: false, loadError: "Não foi possível carregar as configurações de busca e rastreamento." }));
      }
    })();
    return () => { cancelled = true; };
  }, [api, reloadTick]);

  const setSeo = useCallback((partial: Partial<SeoSettings>) => {
    setState((p) => {
      const next = { ...p.seo, ...partial };
      const errors = { ...validateSeo(next), ...validateGtm(p.gtm) };
      return { ...p, seo: next, errors };
    });
  }, []);

  const setGtm = useCallback((partial: Partial<GtmSettings>) => {
    setState((p) => {
      const next = { ...p.gtm, ...partial };
      const errors = { ...validateSeo(p.seo), ...validateGtm(next) };
      return { ...p, gtm: next, errors };
    });
  }, []);

  const setSlug = useCallback((slug: string) => {
    setState((p) => ({ ...p, slug }));
  }, []);

  const handleSave = useCallback(async () => {
    if (working.current || state.loading || state.loadError) return;
    const seoErrors = validateSeo(state.seo);
    const gtmErrors = validateGtm(state.gtm);
    const allErrors = { ...seoErrors, ...gtmErrors };
    if (Object.keys(allErrors).length > 0) {
      setState((p) => ({ ...p, errors: allErrors }));
      showToast("error", "Corrija os erros antes de salvar");
      return;
    }

    working.current = true;
    setState((p) => ({ ...p, saving: true, actionError: null, saveMessage: null }));
    let seoSaved = false;
    try {
      await api.putSeoSettings({ seo: state.seo, gtm: state.gtm });
      seoSaved = true;
      await api.putStoreSettings({ slug: state.slug });
      setState((p) => ({ ...p, saving: false, saveMessage: "Configurações de busca e rastreamento salvas." }));
      showToast("success", "Configurações de SEO salvas com sucesso");
    } catch (e) {
      setState((p) => ({ ...p, saving: false, actionError: seoSaved ? "As configurações de busca foram salvas, mas o endereço da loja não foi atualizado. Seu rascunho foi mantido; tente salvar novamente." : "Não foi possível salvar. Suas alterações foram mantidas; tente novamente." }));
    } finally { working.current = false; }
  }, [state.seo, state.gtm, state.slug, state.loading, state.loadError, api]);

  const handleGenerate = useCallback(async (prompt: string, tone: SeoTone, storeCategory?: string) => {
    if (working.current) return;
    working.current = true;
    setState((p) => ({ ...p, generatingAi: true, actionError: null }));
    try {
      const suggestions = await api.generateSeoSuggestions({ prompt, tone, storeCategory });
      setState((p) => ({ ...p, generatingAi: false, suggestions }));
    } catch (e) {
      setState((p) => ({ ...p, generatingAi: false, actionError: "Não foi possível gerar sugestões. A descrição do negócio foi mantida para você tentar novamente." }));
    } finally { working.current = false; }
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
  const closeGeneratorModal = useCallback(() => { if (!working.current) setState((p) => ({ ...p, showGeneratorModal: false, suggestions: null, actionError: null })); }, []);
  const toggleSection = useCallback((section: "og" | "pixels") => setState((p) => ({ ...p, expandedSections: { ...p.expandedSections, [section]: !p.expandedSections[section] } })), []);

  return {
    state,
    reload: () => setReloadTick(n => n + 1),
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
