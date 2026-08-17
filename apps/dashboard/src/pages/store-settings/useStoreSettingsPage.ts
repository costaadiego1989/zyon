import { useEffect, useState } from "react";
import { useApi } from "../../hooks/useApi.js";
import { DashboardHttpError } from "../../api/http/index.js";
import { showToast } from "../../components/Toast.js";

export interface StoreSettingsState {
  company: CompanyForm;
  policies: PoliciesForm;
  social: SocialForm;
  businessHours: BusinessHour[];
  styles: StylesForm;
  activeTab: "company" | "policies" | "social" | "styles";
  loading: boolean;
  saving: boolean;
  saveResult: "success" | "error" | null;
  saveError: string | null;
  cepLoading: boolean;
  generatingPolicy: string | null;
  logoUrl: string;
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
  const [state, setState] = useState<StoreSettingsState>({
    company: EMPTY_COMPANY,
    policies: EMPTY_POLICIES,
    social: EMPTY_SOCIAL,
    businessHours: EMPTY_BUSINESS_HOURS,
    styles: EMPTY_STYLES,
    activeTab: "company",
    loading: true,
    saving: false,
    saveResult: null,
    saveError: null,
    cepLoading: false,
    generatingPolicy: null,
    logoUrl: "",
  });

  useEffect(() => {
    let cancelled = false;
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

        setState((prev) => ({
          ...prev,
          company: settings?.company ? {
            storeName: profile.name ?? "",
            cnpj: settings.company.cnpj ?? "",
            razaoSocial: settings.company.razaoSocial ?? "",
            inscricaoEstadual: settings.company.inscricaoEstadual ?? "",
            email: settings.company.email ?? "",
            phone: settings.company.phone ?? "",
            street: settings.company.address?.street ?? "",
            number: settings.company.address?.number ?? "",
            complement: settings.company.address?.complement ?? "",
            neighborhood: settings.company.address?.neighborhood ?? "",
            city: settings.company.address?.city ?? "",
            state: settings.company.address?.state ?? "",
            zip: settings.company.address?.zip ?? "",
          } : { ...EMPTY_COMPANY, storeName: profile.name ?? "" },
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
          loading: false,
        }));
      } catch {
        if (!cancelled) setState((p) => ({ ...p, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function handleCepChange(zip: string) {
    setState((p) => ({ ...p, company: { ...p.company, zip } }));
    const digits = zip.replace(/\D/g, "");
    if (digits.length < 8) return;
    setState((p) => ({ ...p, cepLoading: true }));
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json() as any;
      if (data.erro) {
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
    } catch {
      setState((p) => ({ ...p, cepLoading: false }));
    }
  }

  async function handleSave() {
    setState((p) => ({ ...p, saving: true, saveResult: null, saveError: null }));
    try {
      if (state.activeTab === "styles") {
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
        const payload = {
          social: Object.fromEntries(Object.entries(state.social).filter(([, v]) => v)),
          company: {
            ...(state.company.cnpj && { cnpj: state.company.cnpj }),
            ...(state.company.razaoSocial && { razaoSocial: state.company.razaoSocial }),
            ...(state.company.inscricaoEstadual && { inscricaoEstadual: state.company.inscricaoEstadual }),
            ...(state.company.email && { email: state.company.email }),
            ...(state.company.phone && { phone: state.company.phone }),
            address: {
              street: state.company.street,
              number: state.company.number,
              complement: state.company.complement,
              neighborhood: state.company.neighborhood,
              city: state.company.city,
              state: state.company.state,
              zip: state.company.zip,
            },
          },
          businessHours: state.businessHours,
          policies: Object.fromEntries(Object.entries(state.policies).filter(([, v]) => v)),
          ...(state.logoUrl && { logoUrl: state.logoUrl }),
        };
        await api.putStoreSettings(payload);
        if (state.company.storeName) {
          await api.putStoreName(state.company.storeName);
        }
      }
      setState((p) => ({ ...p, saveResult: "success", saving: false }));
      showToast("success", "Configurações salvas com sucesso");
    } catch (e) {
      const msg = e instanceof DashboardHttpError ? e.responseBody.slice(0, 180) : e instanceof Error ? e.message : String(e);
      setState((p) => ({ ...p, saveResult: "error", saveError: msg, saving: false }));
      showToast("error", msg || "Erro ao salvar configurações");
    }
  }

  async function generatePolicy(type: "privacy" | "returns" | "terms" | "shipping") {
    setState((p) => ({ ...p, generatingPolicy: type }));
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
      setState((p) => ({ ...p, generatingPolicy: null }));
    }
  }

  return {
    state,
    setState,
    setCompany: (company: CompanyForm) => setState((p) => ({ ...p, company })),
    setPolicies: (policies: PoliciesForm) => setState((p) => ({ ...p, policies })),
    setSocial: (social: SocialForm) => setState((p) => ({ ...p, social })),
    setBusinessHours: (hours: BusinessHour[]) => setState((p) => ({ ...p, businessHours: hours })),
    setStyles: (styles: StylesForm) => setState((p) => ({ ...p, styles })),
    setLogoUrl: (url: string) => setState((p) => ({ ...p, logoUrl: url })),
    setActiveTab: (tab: "company" | "policies" | "social" | "styles") => setState((p) => ({ ...p, activeTab: tab })),
    handleCepChange,
    handleSave,
    generatePolicy,
    dismiss: () => setState((p) => ({ ...p, saveResult: null })),
  };
}
