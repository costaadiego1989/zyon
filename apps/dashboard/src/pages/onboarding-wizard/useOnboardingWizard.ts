import { useEffect, useState } from "react";
import type {
  MerchantProfile,
  OnboardingStateResponse,
  OnboardingStepId,
} from "../../api-client.js";
import { useApi, type DashboardApi } from "../../hooks/useApi.js";
import type { MerchantTheme } from "@zyon/shared-types";
import {
  validateThemeDraft,
  friendlyError,
} from "./validation/schemas.js";
import type { LucideIcon } from "lucide-react";
import { Palette, MapPin, Truck, CreditCard, Key, Plug } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export type ThemeDraft = Pick<MerchantTheme, "accentColor" | "logoUrl" | "headerTitle" | "agentName"> & {
  secondaryColor: string;
  headingFont: string;
  bodyFont: string;
  originZip: string;
  storeCategory: string;
};

export type AddressDraft = {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type PaymentDraft = {
  stripeStatus: "idle" | "pending" | "active";
  asaasApiKey: string;
  asaasStatus: "idle" | "testing" | "pending" | "active" | "error";
  cryptoEnabled: boolean;
  walletAddress: string;
};

export type PlatformChoice = "native" | "woocommerce" | "magento" | "vtex";

export type IntegrationDraft = {
  platform: PlatformChoice;
};

export type StepMeta = {
  id: number;
  label: string;
  caption: string;
  icon: LucideIcon;
};

// ── Constants ────────────────────────────────────────────────────────────────

export const STEPS: StepMeta[] = [
  { id: 1, label: "Identidade", caption: "Logo, cores, tipografia e agente", icon: Palette },
  { id: 2, label: "Endereço", caption: "CEP e localização da loja", icon: MapPin },
  { id: 3, label: "Frete", caption: "Conecte sua conta de envios", icon: Truck },
  { id: 4, label: "Pagamento", caption: "Como você vai receber", icon: CreditCard },
  { id: 5, label: "API Key", caption: "Credenciais de integração", icon: Key },
  { id: 6, label: "Integração", caption: "Conectar com sua plataforma", icon: Plug },
];

export const TOTAL_STEPS = STEPS.length;

export const FONT_OPTIONS = [
  "Inter, ui-sans-serif, system-ui, sans-serif",
  "DM Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Plus Jakarta Sans, Inter, ui-sans-serif, system-ui, sans-serif",
  "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
  "Space Grotesk, Inter, ui-sans-serif, system-ui, sans-serif",
  "Sora, Inter, ui-sans-serif, system-ui, sans-serif",
  "Poppins, Inter, ui-sans-serif, system-ui, sans-serif",
  "Outfit, Inter, ui-sans-serif, system-ui, sans-serif",
];

export const STORE_CATEGORIES: { value: string; label: string; emoji: string }[] = [
  { value: "electronics", label: "Eletrônicos & Tecnologia", emoji: "💻" },
  { value: "fashion", label: "Moda & Vestuário", emoji: "👗" },
  { value: "beauty", label: "Beleza & Cosméticos", emoji: "💄" },
  { value: "home_decor", label: "Casa & Decoração", emoji: "🏠" },
  { value: "sports", label: "Esportes & Fitness", emoji: "⚽" },
  { value: "food_beverage", label: "Alimentos & Bebidas", emoji: "🍕" },
  { value: "health", label: "Saúde & Bem-estar", emoji: "💊" },
  { value: "pet", label: "Pet Shop", emoji: "🐾" },
  { value: "automotive", label: "Automotivo", emoji: "🚗" },
  { value: "gaming", label: "Games & Entretenimento", emoji: "🎮" },
  { value: "books_education", label: "Livros & Educação", emoji: "📚" },
  { value: "toys_kids", label: "Brinquedos & Infantil", emoji: "🧸" },
  { value: "jewelry_watches", label: "Joias & Relógios", emoji: "💎" },
  { value: "furniture", label: "Móveis", emoji: "🛋️" },
  { value: "groceries", label: "Supermercado & Mercearia", emoji: "🛒" },
  { value: "pharmacy", label: "Farmácia", emoji: "🏥" },
  { value: "office_supplies", label: "Papelaria & Escritório", emoji: "📎" },
  { value: "music_instruments", label: "Instrumentos Musicais", emoji: "🎸" },
  { value: "digital_products", label: "Produtos Digitais", emoji: "📱" },
  { value: "services", label: "Serviços", emoji: "🔧" },
  { value: "saas_software", label: "SaaS & Software", emoji: "☁️" },
  { value: "courses_education", label: "Cursos & Infoprodutos", emoji: "🎓" },
  { value: "subscriptions", label: "Assinaturas & Recorrência", emoji: "🔄" },
  { value: "consulting", label: "Consultoria", emoji: "💼" },
  { value: "freelance", label: "Freelance & Serviços Criativos", emoji: "🎨" },
  { value: "events_tickets", label: "Eventos & Ingressos", emoji: "🎟️" },
  { value: "handmade_artisan", label: "Artesanato & Handmade", emoji: "🧶" },
  { value: "adult", label: "Adulto & Sensual", emoji: "🔞" },
  { value: "cannabis_cbd", label: "Cannabis & CBD", emoji: "🌿" },
  { value: "luxury", label: "Luxo & Premium", emoji: "✨" },
  { value: "sustainability_eco", label: "Sustentável & Eco", emoji: "♻️" },
  { value: "religious", label: "Religioso & Espiritual", emoji: "🕊️" },
  { value: "industrial_b2b", label: "Industrial & B2B", emoji: "🏭" },
  { value: "wholesale", label: "Atacado", emoji: "📦" },
  { value: "dropshipping", label: "Dropshipping", emoji: "🚀" },
  { value: "print_on_demand", label: "Print on Demand", emoji: "🖨️" },
  { value: "marketplace", label: "Marketplace", emoji: "🏪" },
  { value: "multi_category", label: "Multi-categoria", emoji: "🗂️" },
  { value: "others", label: "Outros", emoji: "📋" },
];

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_THEME_DRAFT: ThemeDraft = {
  accentColor: "#0F766E",
  secondaryColor: "#1E40AF",
  headingFont: FONT_OPTIONS[3]!,
  bodyFont: FONT_OPTIONS[0]!,
  logoUrl: "",
  headerTitle: "",
  agentName: "Assistente Zyon",
  originZip: "",
  storeCategory: "",
};

const DEFAULT_ADDRESS_DRAFT: AddressDraft = {
  zip: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "",
};

const DEFAULT_PAYMENT_DRAFT: PaymentDraft = {
  stripeStatus: "idle",
  asaasApiKey: "",
  asaasStatus: "idle",
  cryptoEnabled: false,
  walletAddress: "",
};

const DEFAULT_INTEGRATION_DRAFT: IntegrationDraft = {
  platform: "native",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isValidEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

// ── ViewModel Interface ──────────────────────────────────────────────────────

export interface OnboardingWizardVM {
  currentStep: number;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  busy: boolean;
  message: string | null;
  themeDraft: ThemeDraft;
  setThemeDraft: React.Dispatch<React.SetStateAction<ThemeDraft>>;
  addressDraft: AddressDraft;
  setAddressDraft: React.Dispatch<React.SetStateAction<AddressDraft>>;
  paymentDraft: PaymentDraft;
  setPaymentDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  integrationDraft: IntegrationDraft;
  setIntegrationDraft: React.Dispatch<React.SetStateAction<IntegrationDraft>>;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  generatedApiKey: { id: string; secretKey: string; name: string } | null;
  setGeneratedApiKey: React.Dispatch<React.SetStateAction<{ id: string; secretKey: string; name: string } | null>>;
  onboardingState: OnboardingStateResponse | null;
  setOnboardingState: React.Dispatch<React.SetStateAction<OnboardingStateResponse | null>>;

  saveStep1: () => Promise<void>;
  saveStep2: () => Promise<void>;
  saveStep3: () => Promise<void>;
  initiateStripeOnboarding: () => Promise<void>;
  initiateAsaasOnboarding: () => Promise<void>;
  finish: () => Promise<void>;
  goBack: () => void;
  markOnboardingStep: (step: OnboardingStepId) => Promise<void>;
  generateApiKey: () => Promise<void>;

  activeMeta: StepMeta | undefined;
  totalSteps: number;
  steps: StepMeta[];
  storageKey: string;

  FONT_OPTIONS: typeof FONT_OPTIONS;
  STORE_CATEGORIES: typeof STORE_CATEGORIES;

  me: MerchantProfile;
  apiBaseUrl: string;
  onFinished: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface OnboardingWizardProps {
  apiBaseUrl: string;
  me: MerchantProfile;
  onFinished: () => void;
}

export function useOnboardingWizard(props: OnboardingWizardProps): OnboardingWizardVM {
  const api = useApi();

  const STORAGE_KEY = `onb_draft_${props.me.id}`;

  function loadDrafts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* corrupted */ }
    return null;
  }

  const saved = loadDrafts();

  const [currentStep, setCurrentStep] = useState(saved?.step ?? 1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [onboardingState, setOnboardingState] = useState<OnboardingStateResponse | null>(null);

  const [themeDraft, setThemeDraft] = useState<ThemeDraft>(saved?.theme ?? { ...DEFAULT_THEME_DRAFT, headerTitle: props.me.name });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(saved?.address ?? DEFAULT_ADDRESS_DRAFT);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(saved?.payment ?? DEFAULT_PAYMENT_DRAFT);
  const [integrationDraft, setIntegrationDraft] = useState<IntegrationDraft>(saved?.integration ?? DEFAULT_INTEGRATION_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generatedApiKey, setGeneratedApiKey] = useState<{ id: string; secretKey: string; name: string } | null>(null);

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, theme: themeDraft, address: addressDraft, payment: paymentDraft }));
  }, [currentStep, themeDraft, addressDraft, paymentDraft]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await api.getOnboardingState();
        if (active) {
          setOnboardingState(s);
          if (s.completed) localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {
        if (active) setMessage(friendlyError(e));
      }
    })();
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const connections = await api.getPaymentConnections();
        if (!active) return;
        const stripe = connections.find((c) => c.provider === "stripe");
        if (stripe && stripe.account_id) {
          setPaymentDraft((d) => ({ ...d, stripeStatus: "active" }));
        }
        const asaas = connections.find((c) => c.provider === "asaas");
        if (asaas) {
          setPaymentDraft((d) => ({ ...d, asaasStatus: asaas.status === "active" ? "active" : "idle" }));
        }
      } catch {
        // No connections yet
      }
    })();
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    if (saved) return;
    let active = true;
    void (async () => {
      try {
        const [theme] = await Promise.all([
          api.getMerchantTheme(),
          api.getMerchantRules(),
          api.getCheckoutSettings(),
        ]);
        if (!active) return;
        setThemeDraft({
          accentColor: theme.accentColor ?? DEFAULT_THEME_DRAFT.accentColor,
          secondaryColor: theme.secondaryColor ?? DEFAULT_THEME_DRAFT.secondaryColor,
          headingFont: theme.fontDisplay ?? DEFAULT_THEME_DRAFT.headingFont,
          bodyFont: theme.fontFamily ?? DEFAULT_THEME_DRAFT.bodyFont,
          logoUrl: theme.logoUrl ?? "",
          headerTitle: theme.headerTitle ?? "",
          agentName: theme.agentName ?? "",
          originZip: "",
          storeCategory: "",
        });
      } catch {
        // drafts stay at defaults
      }
    })();
    return () => { active = false; };
  }, [api]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function markOnboardingStep(step: OnboardingStepId) {
    try {
      const next = await api.completeOnboardingStep(step);
      setOnboardingState(next);
    } catch {
      // non-blocking
    }
  }

  async function saveStep1() {
    const errors = validateThemeDraft(themeDraft);
    if (errors.length > 0) {
      setFieldErrors(Object.fromEntries(
        errors
          .filter((e): e is { valid: false; field: string; message: string } => !e.valid)
          .map((e) => [e.field, e.message]),
      ));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setMessage(null);
    try {
      let current: Record<string, unknown> = {};
      try { current = (await api.getMerchantTheme()) as unknown as Record<string, unknown>; } catch {}
      const { originZip, storeCategory, secondaryColor, headingFont, bodyFont, ...themeFields } = themeDraft;

      let finalLogoUrl = themeFields.logoUrl;
      if (finalLogoUrl && finalLogoUrl.startsWith("data:")) {
        try {
          const { logoUrl } = await api.uploadLogo(finalLogoUrl);
          finalLogoUrl = logoUrl;
        } catch {
          // S3 upload failed — fall back to base64 inline
        }
      }

      const payload = { ...current, ...themeFields, logoUrl: finalLogoUrl, secondaryColor, fontDisplay: headingFont, fontFamily: bodyFont } as Parameters<typeof api.putMerchantTheme>[0];
      await api.putMerchantTheme(payload);
      if (originZip) {
        try { await api.putMerchantRules({ originZip }); } catch {}
      }
      if (storeCategory) {
        try { await api.putStoreCategory(storeCategory); } catch {}
      }
      await markOnboardingStep("account");
      setCurrentStep(2);
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep2() {
    if (!addressDraft.zip || addressDraft.zip.replace(/\D/g, "").length < 8) {
      setFieldErrors({ zip: "CEP obrigatório (8 dígitos)" });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setMessage(null);
    try {
      await api.putStoreSettings({
        company: {
          address: {
            street: addressDraft.street,
            number: addressDraft.number,
            complement: addressDraft.complement,
            neighborhood: addressDraft.neighborhood,
            city: addressDraft.city,
            state: addressDraft.state,
            zip: addressDraft.zip,
          },
        },
      });
      try { await api.putMerchantRules({ originZip: addressDraft.zip.replace(/\D/g, "") }); } catch {}
      await markOnboardingStep("checkout_config");
      setCurrentStep(3);
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep3() {
    const trimmedWallet = paymentDraft.walletAddress.trim();
    if (trimmedWallet !== paymentDraft.walletAddress) {
      setPaymentDraft((d) => ({ ...d, walletAddress: trimmedWallet }));
    }

    if (paymentDraft.cryptoEnabled && !isValidEvmAddress(trimmedWallet)) {
      setFieldErrors({ walletAddress: "Endereço EVM inválido (0x + 40 caracteres hex)" });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setMessage(null);
    try {
      const hasCrypto = paymentDraft.cryptoEnabled && isValidEvmAddress(trimmedWallet);
      if (hasCrypto) {
        await api.putMerchantRules({
          cryptoPayments: {
            enabled: true,
            chain: "polygon",
            network: "mainnet",
            treasuryAddress: trimmedWallet,
            token: "USDC",
            quoteTtlSeconds: 300,
          },
        });
      }
      await markOnboardingStep("checkout_config");

      // STORE_ONLY plan finishes onboarding here — no embed/integration needed
      const plan = (props.me as any).plan;
      if (plan === "STORE_ONLY") {
        await markOnboardingStep("embed");
        await markOnboardingStep("publish");
        localStorage.removeItem(STORAGE_KEY);
        setOnboardingState((prev) => prev ? { ...prev, completed: true } : prev);
      } else {
        setCurrentStep(4);
      }
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function initiateStripeOnboarding() {
    setBusy(true);
    setMessage(null);
    try {
      const baseUrl = window.location.origin;
      const { url } = await api.createStripeOnboardingLink({
        return_url: baseUrl,
        refresh_url: baseUrl,
      });
      setPaymentDraft((d) => ({ ...d, stripeStatus: "pending" }));
      window.location.href = url;
    } catch (e) {
      setPaymentDraft((d) => ({ ...d, stripeStatus: "idle" }));
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function initiateAsaasOnboarding() {
    setBusy(true);
    setMessage(null);
    setPaymentDraft((d) => ({ ...d, asaasStatus: "testing" }));
    try {
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.origin });
      setPaymentDraft((d) => ({ ...d, asaasStatus: "pending" }));
      window.location.href = url;
    } catch {
      try {
        await api.createAsaasSubaccount({
          name: props.me.name,
          email: `store-${props.me.id.slice(-8)}@zyon.ai`,
          cpf_cnpj: (props.me as any).cnpj ?? "05178178700",
          birth_date: "1989-01-01",
          mobile_phone: (props.me as any).phone ?? "19998887766",
          income_value: 10000,
          postal_code: addressDraft.zip?.replace(/\D/g, "") ?? "01311100",
          address: addressDraft.street || "Não informado",
          address_number: addressDraft.number || "0",
          province: addressDraft.neighborhood || "Centro",
          complement: addressDraft.complement ?? "",
        });
        setMessage("Subconta Asaas criada! Redirecionando...");
        await new Promise((r) => setTimeout(r, 16000));
        const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.origin });
        setPaymentDraft((d) => ({ ...d, asaasStatus: "pending" }));
        window.location.href = url;
      } catch {
        // Subaccount may already exist (409)
        setPaymentDraft((d) => ({ ...d, asaasStatus: "active" }));
        setMessage("Asaas já configurado para esta conta.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function generateApiKey() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.createIntegrationApiKey({
        name: "Onboarding key",
        scopes: ["checkout:read", "checkout:write", "configuration:read", "embed:sessions:create", "orders:read", "catalog:read", "commerce:read"],
      });
      setGeneratedApiKey({ id: result.api_key.id, secretKey: result.secret_key, name: result.api_key.name });
      await markOnboardingStep("embed");
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep4AndFinish() {
    setBusy(true);
    setMessage(null);
    try {
      await markOnboardingStep("checkout_config");
      await markOnboardingStep("embed");
      await markOnboardingStep("publish");
      localStorage.removeItem(STORAGE_KEY);
      setOnboardingState((prev) => prev ? { ...prev, completed: true } : prev);
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await saveStep4AndFinish();
  }

  function goBack() {
    setMessage(null);
    setFieldErrors({});
    setCurrentStep((s: number) => Math.max(1, s - 1));
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const isStoreOnly = (props.me as any).plan === "STORE_ONLY";
  const visibleSteps = isStoreOnly ? STEPS.slice(0, 3) : STEPS;
  const totalSteps = visibleSteps.length;
  const activeMeta = STEPS[currentStep - 1];

  return {
    currentStep,
    setCurrentStep,
    busy,
    message,
    themeDraft,
    setThemeDraft,
    addressDraft,
    setAddressDraft,
    paymentDraft,
    setPaymentDraft,
    integrationDraft,
    setIntegrationDraft,
    fieldErrors,
    setFieldErrors,
    generatedApiKey,
    setGeneratedApiKey,
    onboardingState,
    setOnboardingState,

    saveStep1,
    saveStep2,
    saveStep3,
    initiateStripeOnboarding,
    initiateAsaasOnboarding,
    finish,
    goBack,
    markOnboardingStep,
    generateApiKey,

    activeMeta,
    totalSteps,
    steps: visibleSteps,
    storageKey: STORAGE_KEY,

    FONT_OPTIONS,
    STORE_CATEGORIES,

    me: props.me,
    apiBaseUrl: props.apiBaseUrl,
    onFinished: props.onFinished,
  };
}
