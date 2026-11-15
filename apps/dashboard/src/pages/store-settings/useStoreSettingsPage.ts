import { useEffect, useRef, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { reportError } from "../../hooks/useErrorReporter.js";
import { lookupViaCep } from "../../api/external/via-cep.js";
import { showToast } from "../../components/Toast.js";
import { normalizeBudgetSettings, readBudgetSettings, validateBudgetSettings, type BudgetErrors } from "./budget-settings.js";

export interface StoreSettingsState {
  company: CompanyForm;
  policies: PoliciesForm;
  social: SocialForm;
  businessHours: BusinessHour[];
  styles: StylesForm;
  activeTab: "company" | "policies" | "social" | "styles" | "seo-gtm" | "budget";
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  saveResult: "success" | "error" | null;
  saveError: string | null;
  cepLoading: boolean;
  generatingPolicy: string | null;
  logoUrl: string;
  budgetMode: boolean;
  budgetEmail: string;
  budgetWhatsapp: string;
  budgetAvailable: boolean;
  budgetErrors: BudgetErrors;
}

export interface StylesForm {
  logoUrl: string;
  faviconUrl: string;
  accentColor: string;
  secondaryColor: string;
  fontDisplay: string;
  fontFamily: string;
}

export interface CompanyForm {
  description: string;
  storeName: string;
  cnpj: string;
  razaoSocial: string;
  inscricaoEstadual: string;
  email: string;
  phone: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip: string;
}

export interface BusinessHour {
  day: "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
  startTime: string;
  endTime: string;
  closed: boolean;
}

export interface PoliciesForm {
  privacy: string;
  returns: string;
  terms: string;
  shipping: string;
}

export interface SocialForm {
  instagram: string;
  facebook: string;
  linkedin: string;
  youtube: string;
  googleMaps: string;
}

const EMPTY_COMPANY: CompanyForm = {
  description: "",
  storeName: "", cnpj: "", razaoSocial: "", inscricaoEstadual: "", email: "",
  phone: "", street: "", number: "", complement: "", neighborhood: "",
  city: "", state: "", zip: "",
};
const EMPTY_POLICIES: PoliciesForm = { privacy: "", returns: "", terms: "", shipping: "" };
const EMPTY_SOCIAL: SocialForm = { instagram: "", facebook: "", linkedin: "", youtube: "", googleMaps: "" };
const EMPTY_STYLES: StylesForm = { logoUrl: "", faviconUrl: "", accentColor: "#000000", secondaryColor: "#666666", fontDisplay: "Inter, ui-sans-serif, system-ui, sans-serif", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" };
const EMPTY_BUSINESS_HOURS: BusinessHour[] = [
  { day: "seg", startTime: "09:00", endTime: "18:00", closed: false },
  { day: "ter", startTime: "09:00", endTime: "18:00", closed: false },
  { day: "qua", startTime: "09:00", endTime: "18:00", closed: false },
  { day: "qui", startTime: "09:00", endTime: "18:00", closed: false },
  { day: "sex", startTime: "09:00", endTime: "18:00", closed: false },
  { day: "sab", startTime: "09:00", endTime: "13:00", closed: false },
  { day: "dom", startTime: "", endTime: "", closed: true },
];

export function useStoreSettingsPage() {
  const api = useApi();
  const working = useRef(false);
  const companyBaseline = useRef<CompanyForm>(EMPTY_COMPANY);
  const hoursBaseline = useRef(EMPTY_BUSINESS_HOURS);
  const logoBaseline = useRef("");
  const [reloadTick, setReloadTick] = useState(0);
  const [state, setState] = useState<StoreSettingsState>({
    company: EMPTY_COMPANY,
    policies: EMPTY_POLICIES,
    social: EMPTY_SOCIAL,
    businessHours: EMPTY_BUSINESS_HOURS,
    styles: EMPTY_STYLES,
    activeTab: "company",
    loading: true,
    loadError: null,
    saving: false,
    saveResult: null,
    saveError: null,
    cepLoading: false,
    generatingPolicy: null,
    logoUrl: "",
    budgetMode: false,
    budgetEmail: "",
    budgetWhatsapp: "",
    budgetAvailable: false,
    budgetErrors: {},
  });

  useEffect(() => {
    let cancelled = false;
    setState(p => ({ ...p, loading: true, loadError: null }));
    (async () => {
      try {
        const [settings, profile] = await Promise.all([
          api.getStoreSettings() as Promise<Record<string, any>>,
          api.merchantProfile(),
        ]);
        if (cancelled) return;

        const loadedLogoUrl = settings?.logoUrl ?? "";
        let theme: any = null;
        try {
          theme = await api.getMerchantTheme();
        } catch {}

        if (cancelled) return;
        const budget = readBudgetSettings(settings);
        const company: CompanyForm = settings?.company ? {
          description: typeof settings.company.description === "string" ? settings.company.description : "",
          storeName: profile.name ?? "", cnpj: settings.company.cnpj ?? "", razaoSocial: settings.company.razaoSocial ?? "",
          inscricaoEstadual: settings.company.inscricaoEstadual ?? "", email: settings.company.email ?? "", phone: settings.company.phone ?? "",
          street: settings.company.address?.street ?? "", number: settings.company.address?.number ?? "", complement: settings.company.address?.complement ?? "",
          neighborhood: settings.company.address?.neighborhood ?? "", city: settings.company.address?.city ?? "", state: settings.company.address?.state ?? "", zip: settings.company.address?.zip ?? "",
        } : { ...EMPTY_COMPANY, storeName: profile.name ?? "" };
        companyBaseline.current = company;
        hoursBaseline.current = settings?.businessHours ?? EMPTY_BUSINESS_HOURS;
        logoBaseline.current = loadedLogoUrl;
        setState((prev) => ({
          ...prev,
          company,
          policies: settings?.policies ? { ...EMPTY_POLICIES, ...settings.policies } : EMPTY_POLICIES,
          social: settings?.social ? { ...EMPTY_SOCIAL, ...settings.social } : EMPTY_SOCIAL,
          businessHours: settings?.businessHours ?? EMPTY_BUSINESS_HOURS,
          styles: {
            logoUrl: theme?.logoUrl ?? loadedLogoUrl ?? "",
            faviconUrl: theme?.faviconUrl ?? "",
            accentColor: theme?.accentColor ?? "#000000",
            secondaryColor: theme?.secondaryColor ?? "#666666",
            fontDisplay: theme?.fontDisplay ?? "Inter, ui-sans-serif, system-ui, sans-serif",
            fontFamily: theme?.fontFamily ?? "Inter, ui-sans-serif, system-ui, sans-serif",
          },
          logoUrl: loadedLogoUrl,
          budgetMode: budget?.enabled ?? false,
          budgetEmail: budget?.email ?? "",
          budgetWhatsapp: budget?.whatsapp ?? "",
          budgetAvailable: budget !== null,
          budgetErrors: {},
          loading: false,
        }));
      } catch {
        if (!cancelled) setState((p) => ({ ...p, loading: false, loadError: "Não foi possível carregar as configurações atuais da loja." }));
      }
    })();
    return () => { cancelled = true; };
  }, [api, reloadTick]);

  async function handleCepChange(zip: string) {
    setState((p) => ({ ...p, company: { ...p.company, zip } }));
    const digits = zip.replace(/\D/g, "");
    if (digits.length < 8) return;
    setState((p) => ({ ...p, cepLoading: true }));
    const data = await lookupViaCep(digits);
    if (!data) {
      setState((p) => ({ ...p, cepLoading: false }));
      return;
    }
    setState((p) => ({
      ...p,
      company: {
        ...p.company,
        street: data.logradouro || "",
        neighborhood: data.bairro || "",
        city: data.localidade || "",
        state: data.uf || "",
      },
      cepLoading: false,
    }));
  }

  async function handleSave() {
    if (working.current || state.loading || state.loadError) return;
    if (state.activeTab === "company" && state.company.description !== companyBaseline.current.description && state.company.description.length > 1200) {
      setState(p => ({ ...p, saveResult: "error", saveError: "Sobre a empresa deve ter até 1.200 caracteres." }));
      return;
    }
    const isBudget = state.activeTab === "budget";
    const budget = { enabled: state.budgetMode, email: state.budgetEmail, whatsapp: state.budgetWhatsapp };
    if (isBudget) {
      if (!state.budgetAvailable) return;
      const budgetErrors = validateBudgetSettings(budget);
      if (Object.keys(budgetErrors).length) {
        setState(p => ({ ...p, budgetErrors, saveResult: null, saveError: "Revise os contatos de orçamento antes de salvar." }));
        return;
      }
    }
    working.current = true;
    let settingsSaved = false;
    setState((p) => ({ ...p, saving: true, saveResult: null, saveError: null }));
    try {
      if (isBudget) {
        const requested = normalizeBudgetSettings(budget);
        const saved = readBudgetSettings(await api.putStoreSettings({ budget: requested }));
        if (!saved || saved.enabled !== requested.enabled || saved.email !== requested.email || saved.whatsapp !== requested.whatsapp) {
          throw new Error("budget_settings_not_confirmed");
        }
        setState(p => ({ ...p, budgetMode: saved.enabled, budgetEmail: saved.email, budgetWhatsapp: saved.whatsapp, budgetErrors: {} }));
      } else if (state.activeTab === "styles") {
        // Save theme
        await api.putMerchantTheme({
          logoUrl: state.styles.logoUrl,
          faviconUrl: state.styles.faviconUrl,
          accentColor: state.styles.accentColor,
          secondaryColor: state.styles.secondaryColor,
          fontDisplay: state.styles.fontDisplay,
          fontFamily: state.styles.fontFamily,
        } as any);
      } else {
        // Save store settings
        const company = companyFormPatch(state.company, companyBaseline.current);
        const payload = state.activeTab === "company" ? {
          ...(Object.keys(company).length ? { company } : {}),
          ...(JSON.stringify(state.businessHours) !== JSON.stringify(hoursBaseline.current) ? { businessHours: state.businessHours } : {}),
          ...(state.logoUrl !== logoBaseline.current ? { logoUrl: state.logoUrl } : {}),
        } : state.activeTab === "policies" ? {
          policies: Object.fromEntries(Object.entries(state.policies).filter(([, value]) => value)),
        } : { social: Object.fromEntries(Object.entries(state.social).filter(([, value]) => value)) };
        const saved = await api.putStoreSettings(payload) as Record<string, any>;
        if (state.activeTab === "company" && Object.hasOwn(company, "description") && saved?.company?.description !== state.company.description.trim()) {
          throw new Error("company_description_not_confirmed");
        }
        settingsSaved = true;
        if (state.activeTab === "company" && state.company.storeName && state.company.storeName !== companyBaseline.current.storeName) {
          await api.putStoreName(state.company.storeName);
        }
        if (state.activeTab === "company") {
          const description = Object.hasOwn(company, "description") ? saved.company.description as string : state.company.description;
          companyBaseline.current = { ...state.company, description };
          hoursBaseline.current = state.businessHours;
          logoBaseline.current = state.logoUrl;
          setState(p => ({ ...p, company: { ...p.company, description } }));
        }
      }
      setState((p) => ({ ...p, saveResult: "success", saving: false }));
      showToast("success", isBudget ? "Configurações de orçamento salvas." : "Configurações salvas com sucesso");
    } catch (e) {
      reportError({ source: "dashboard.store-settings.save", error: e });
      const msg = isBudget ? "Não foi possível confirmar o salvamento do orçamento. Seus dados foram mantidos; tente novamente." : settingsSaved ? "As configurações foram salvas, mas o nome da loja não foi atualizado. Seus dados foram mantidos; tente salvar novamente." : "Não foi possível salvar. Suas alterações foram mantidas; tente novamente.";
      setState((p) => ({ ...p, saveResult: "error", saveError: msg, saving: false }));
      showToast("error", msg || "Erro ao salvar configurações");
    } finally { working.current = false; }
  }

  async function generatePolicy(type: "privacy" | "returns" | "terms" | "shipping") {
    if (working.current || state.loading || state.loadError) return;
    working.current = true;
    setState((p) => ({ ...p, generatingPolicy: type, saveError: null, saveResult: null }));
    try {
      const companyData = {
        razaoSocial: state.company.razaoSocial,
        email: state.company.email,
        phone: state.company.phone,
        city: state.company.city,
        state: state.company.state,
      };
      const result = await api.generatePolicy(type, companyData);
      setState((p) => ({
        ...p,
        policies: { ...p.policies, [type]: result.policy },
        generatingPolicy: null,
      }));
    } catch {
      setState((p) => ({ ...p, generatingPolicy: null, saveResult: "error", saveError: "Não foi possível gerar o texto. A política anterior foi mantida." }));
    } finally { working.current = false; }
  }

  return {
    state,
    reload: () => setReloadTick(n => n + 1),
    setState,
    setCompany: (company: CompanyForm) => setState((p) => ({ ...p, company })),
    setPolicies: (policies: PoliciesForm) => setState((p) => ({ ...p, policies })),
    setSocial: (social: SocialForm) => setState((p) => ({ ...p, social })),
    setBusinessHours: (hours: BusinessHour[]) => setState((p) => ({ ...p, businessHours: hours })),
    setStyles: (styles: StylesForm) => setState((p) => ({ ...p, styles })),
    setLogoUrl: (url: string) => setState((p) => ({ ...p, logoUrl: url })),
    setBudgetMode: (v: boolean) => setState((p) => ({ ...p, budgetMode: v, saveResult: null, saveError: null })),
    setBudgetEmail: (v: string) => setState((p) => ({ ...p, budgetEmail: v, budgetErrors: { ...p.budgetErrors, email: undefined }, saveResult: null, saveError: null })),
    setBudgetWhatsapp: (v: string) => setState((p) => ({ ...p, budgetWhatsapp: v, budgetErrors: { ...p.budgetErrors, whatsapp: undefined }, saveResult: null, saveError: null })),
    setActiveTab: (tab: "company" | "policies" | "social" | "styles" | "seo-gtm" | "budget") => setState((p) => ({ ...p, activeTab: tab, saveResult: null, saveError: null })),
    handleCepChange,
    handleSave,
    generatePolicy,
    dismiss: () => setState((p) => ({ ...p, saveResult: null })),
  };
}

function companyFormPatch(current: CompanyForm, baseline: CompanyForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ["description", "cnpj", "razaoSocial", "inscricaoEstadual", "email", "phone"] as const) {
    if (current[key] !== baseline[key]) patch[key] = current[key];
  }
  const address: Record<string, string> = {};
  for (const key of ["street", "number", "complement", "neighborhood", "city", "state", "zip"] as const) {
    if (current[key] !== baseline[key]) address[key] = current[key];
  }
  if (Object.keys(address).length) patch.address = address;
  return patch;
}
