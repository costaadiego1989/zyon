import { useEffect, useState } from "react";
import type {
  MerchantProfile,
  OnboardingStateResponse,
  OnboardingStepId,
} from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { usePlanFeatures } from "../../hooks/api/usePlanFeatures.js";
import { reportError } from "../../lib/observability/error-reporter.js";
import {
  validateThemeDraft,
  friendlyError,
} from "./validation/schemas.js";
import type {
  ThemeDraft,
  AddressDraft,
  PaymentDraft,
  StepMeta,
} from "./types.js";
import { Palette, MapPin, CreditCard, MessageCircle, Sparkles } from "lucide-react";
import { useStepIdentity } from "./hooks/useStepIdentity.js";
import { useStepAddress } from "./hooks/useStepAddress.js";
import { useStepPayment } from "./hooks/useStepPayment.js";
import { useStepReview } from "./hooks/useStepReview.js";

export type { ThemeDraft, AddressDraft, PaymentDraft, IntegrationDraft, PlatformChoice } from "./types.js";
export { isValidEvmAddress } from "./types.js";

export const STEPS: StepMeta[] = [
  { id: 1, label: "Identidade", caption: "Logo, cores, tipografia e agente", icon: Palette },
  { id: 2, label: "Endereço", caption: "CEP e localização da loja", icon: MapPin },
  { id: 3, label: "Pagamento", caption: "Como você vai receber", icon: CreditCard },
  { id: 4, label: "WhatsApp", caption: "Conecte seu WhatsApp Business", icon: MessageCircle },
  { id: 5, label: "Motor de IA", caption: "Ative a IA autônoma de vendas", icon: Sparkles },
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
  mercadopagoStatus: "idle",
  cryptoEnabled: false,
  walletAddress: "",
};


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
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onboardingState: OnboardingStateResponse | null;
  setOnboardingState: React.Dispatch<React.SetStateAction<OnboardingStateResponse | null>>;

  saveStep1: () => Promise<void>;
  saveStep2: () => Promise<void>;
  saveStep3: () => Promise<void>;
  initiateStripeOnboarding: () => Promise<void>;
  initiateAsaasOnboarding: () => Promise<void>;
  initiateMercadoPagoOnboarding: () => Promise<void>;
  completeWhatsAppStep: () => Promise<void>;
  finish: () => Promise<void>;
  goBack: () => void;
  markOnboardingStep: (step: OnboardingStepId) => Promise<void>;

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

export interface OnboardingWizardProps {
  apiBaseUrl: string;
  me: MerchantProfile;
  onFinished: () => void;
}

export function useOnboardingWizard(props: OnboardingWizardProps): OnboardingWizardVM {
  const api = useApi();
  const { plan } = usePlanFeatures();

  const STORAGE_KEY = `onb_draft_${props.me.id}`;

  function loadDrafts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      reportError({ source: "onboarding.loadDrafts", error: err, severity: "warning", context: { storageKey: STORAGE_KEY } });
    }
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
        if (stripe) {
          // Only "active" is truly usable. A restricted/incomplete Stripe
          // account still has an account_id but status !== "active", so keying
          // off account_id alone falsely showed "Ativo". Mirror asaas/mp.
          setPaymentDraft((d) => ({ ...d, stripeStatus: stripe.status === "active" ? "active" : "pending" }));
        }
        const asaas = connections.find((c) => c.provider === "asaas");
        if (asaas) {
          setPaymentDraft((d) => ({ ...d, asaasStatus: asaas.status === "active" ? "active" : "idle" }));
        }
        const mp = connections.find((c) => c.provider === "mercadopago");
        if (mp) {
          setPaymentDraft((d) => ({ ...d, mercadopagoStatus: mp.status === "active" ? "active" : "pending" }));
        }
      } catch (err) {
        reportError({ source: "onboarding.loadPaymentConnections", error: err, severity: "warning" });
      }
    })();
    return () => { active = false; };
  }, [api]);

  // Mercado Pago connects via OAuth redirect back to the dashboard with a
  // ?mercadopago_connected=1 param. Detect it, sync the connection, reflect
  // active, and clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("mercadopago_connected")) return;
    let active = true;
    void (async () => {
      try {
        await api.syncMercadoPagoConnection?.();
        if (active) setPaymentDraft((d) => ({ ...d, mercadopagoStatus: "active" }));
      } catch (err) {
        reportError({ source: "onboarding.syncMercadoPago", error: err, severity: "warning" });
      }
    })();
    params.delete("mercadopago_connected");
    params.delete("mercadopago_error");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
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
      } catch (err) {
        reportError({ source: "onboarding.bootstrapDrafts", error: err, severity: "warning" });
      }
    })();
    return () => { active = false; };
  }, [api]);

  async function markOnboardingStep(step: OnboardingStepId) {
    try {
      const next = await api.completeOnboardingStep(step);
      setOnboardingState(next);
    } catch (err) {
      reportError({ source: "onboarding.markStep", error: err, severity: "warning", context: { step } });
    }
  }

  const { saveStep1 } = useStepIdentity({
    themeDraft,
    setFieldErrors,
    setMessage,
    setBusy,
    markOnboardingStep,
    setCurrentStep,
  });

  const { saveStep2 } = useStepAddress({
    addressDraft,
    setFieldErrors,
    setMessage,
    setBusy,
    markOnboardingStep,
    setCurrentStep,
  });

  const { saveStep3, initiateStripeOnboarding, initiateAsaasOnboarding, initiateMercadoPagoOnboarding } = useStepPayment({
    paymentDraft,
    setPaymentDraft,
    addressDraft,
    setFieldErrors,
    setMessage,
    setBusy,
    markOnboardingStep,
    setCurrentStep,
    setOnboardingState,
    me: props.me,
    storageKey: STORAGE_KEY,
  });

  const { finish } = useStepReview({
    setMessage,
    setBusy,
    markOnboardingStep,
    setOnboardingState,
    storageKey: STORAGE_KEY,
  });

  function goBack() {
    setMessage(null);
    setFieldErrors({});
    setCurrentStep((s: number) => Math.max(1, s - 1));
  }

  async function completeWhatsAppStep() {
    await markOnboardingStep("whatsapp");
    if (isGrowthPlus) {
      setCurrentStep(5);
    } else {
      // No AI step for this plan — finish() marks ai_engine to satisfy the
      // required step set.
      await finish();
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  // Step 5 (Motor de IA) is Growth+ only; lower plans skip it entirely.
  const isGrowthPlus = plan === "growth" || plan === "scale";
  const visibleSteps = isGrowthPlus ? STEPS : STEPS.slice(0, 4);
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
    fieldErrors,
    setFieldErrors,
    onboardingState,
    setOnboardingState,

    saveStep1,
    saveStep2,
    saveStep3,
    initiateStripeOnboarding,
    initiateAsaasOnboarding,
    initiateMercadoPagoOnboarding,
    completeWhatsAppStep,
    finish,
    goBack,
    markOnboardingStep,

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
