import { useEffect, useState } from "react";
import type {
  MerchantProfile,
  OnboardingStateResponse,
  OnboardingStepId,
} from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { usePlanFeatures } from "../../hooks/api/usePlanFeatures.js";
import { reportError } from "../../lib/observability/error-reporter.js";
import { STORE_CATEGORIES } from "../../lib/signup-options.js";
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
import { Palette, MapPin, Truck, CreditCard, MessageCircle, Sparkles } from "lucide-react";
import { useStepIdentity } from "./hooks/useStepIdentity.js";
import { useStepAddress } from "./hooks/useStepAddress.js";
import { useStepPayment } from "./hooks/useStepPayment.js";
import type { AsaasConnectionPayload } from "../payment-connections/components/AsaasConnectionForm.js";
import { useStepShipping } from "./hooks/useStepShipping.js";
import { useStepReview } from "./hooks/useStepReview.js";

export type { ThemeDraft, AddressDraft, PaymentDraft, IntegrationDraft, PlatformChoice } from "./types.js";
export { isValidEvmAddress } from "./types.js";

export const STEPS: StepMeta[] = [
  { id: 1, label: "Identidade", caption: "Logo, cores, tipografia e agente", icon: Palette },
  { id: 2, label: "Endereço", caption: "CEP e localização da loja", icon: MapPin },
  { id: 3, label: "Frete", caption: "Ative uma modalidade de entrega para continuar", icon: Truck },
  { id: 4, label: "Pagamento", caption: "Como você vai receber", icon: CreditCard },
  { id: 5, label: "WhatsApp", caption: "Conecte o número da loja quando estiver pronto", icon: MessageCircle, optional: true },
  { id: 6, label: "Automação de vendas", caption: "Escolha se quer ativar a otimização com IA", icon: Sparkles, optional: true },
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
  initiateAsaasOnboarding: (payload?: AsaasConnectionPayload) => Promise<boolean>;
  initiateMercadoPagoOnboarding: () => Promise<void>;
  advanceFromShipping: () => void;
  shipping: ReturnType<typeof useStepShipping>;
  completeWhatsAppStep: () => Promise<void>;
  finish: () => Promise<void>;
  goBack: () => void;
  retryLoad: () => void;
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
  const [currentStep, setCurrentStep] = useState(Number.isInteger(saved?.step) ? Math.max(1, Math.min(6, saved.step)) : 1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [onboardingState, setOnboardingState] = useState<OnboardingStateResponse | null>(null);
  const [themeDraft, setThemeDraft] = useState<ThemeDraft>(saved?.theme ?? { ...DEFAULT_THEME_DRAFT, headerTitle: props.me.name });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>(saved?.address ?? DEFAULT_ADDRESS_DRAFT);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    ...DEFAULT_PAYMENT_DRAFT,
    ...saved?.payment,
    stripeStatus: "idle", asaasStatus: "idle", mercadopagoStatus: "idle", asaasApiKey: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const shipping = useStepShipping();

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, theme: themeDraft, address: addressDraft })); }
    catch { /* The form remains usable when browser storage is unavailable. */ }
  }, [currentStep, themeDraft, addressDraft]);

  useEffect(() => {
    let active = true;
    setMessage(null);
    void (async () => {
      try {
        const s = await api.getOnboardingState();
        if (active) {
          setOnboardingState(s);
          if (s.completed) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* Optional local draft. */ } }
        }
      } catch (e) {
        if (active) setMessage(friendlyError(e));
      }
    })();
    return () => { active = false; };
  }, [api, loadAttempt]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const syncingStripe = params.has("stripe_connected");
    const syncingMercadoPago = params.has("mercadopago_connected");
    void (async () => {
      try {
        const connections = await api.getPaymentConnections();
        if (!active) return;
        const stripe = connections.find((c) => c.provider === "stripe");
        const asaas = connections.find((c) => c.provider === "asaas");
        const mp = connections.find((c) => c.provider === "mercadopago");
        setPaymentDraft((d) => ({ ...d,
          stripeStatus: syncingStripe ? d.stripeStatus : stripe ? stripe.status === "active" ? "active" : "pending" : "idle",
          asaasStatus: asaas ? asaas.status === "active" ? "active" : "pending" : "idle",
          mercadopagoStatus: syncingMercadoPago ? d.mercadopagoStatus : mp ? mp.status === "active" ? "active" : "pending" : "idle",
        }));
      } catch (err) {
        reportError({ source: "onboarding.loadPaymentConnections", error: err, severity: "warning" });
      }
    })();
    return () => { active = false; };
  }, [api]);

  // A provider redirect means onboarding returned, not that payments are active.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mpConnected = params.has("mercadopago_connected");
    const mpError = params.has("mercadopago_error");
    const stripeReturned = params.has("stripe_connected");
    const stripeRefresh = params.has("stripe_refresh");
    if (!mpConnected && !mpError && !stripeReturned && !stripeRefresh) return;
    setCurrentStep(4);
    if (mpError) setMessage("O Mercado Pago não concluiu a autorização. Tente conectar novamente.");
    if (stripeRefresh) setMessage("O link Stripe expirou. Clique em Configurar ou Continuar para gerar outro.");
    let active = true;
    void (async () => {
      try {
        if (mpConnected) {
          const connection = await api.syncMercadoPagoConnection();
          if (active) {
            setPaymentDraft((d) => ({ ...d, mercadopagoStatus: connection.status === "active" ? "active" : "pending" }));
            setMessage(connection.status === "active" ? "Mercado Pago conectado com sucesso." : "Sua conexão Mercado Pago ainda está pendente.");
          }
        }
        if (stripeReturned) {
          const connection = await api.syncStripeConnection();
          if (active) {
            setPaymentDraft((d) => ({ ...d, stripeStatus: connection.status === "active" ? "active" : "pending" }));
            setMessage(connection.status === "active" ? "Stripe conectado com sucesso." : "Seu cadastro Stripe ainda está pendente. Clique em Continuar para revisar a configuração.");
          }
        }
      } catch (err) {
        if (active) setMessage(friendlyError(err));
        reportError({ source: "onboarding.syncPaymentConnection", error: err, severity: "warning" });
      }
    })();
    for (const key of ["mercadopago_connected", "mercadopago_error", "stripe_connected", "stripe_refresh"]) params.delete(key);
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("shipping_connected") && !params.has("shipping_error")) return;
    setCurrentStep(3);
    if (params.has("shipping_error")) setMessage("A conexão de frete não foi concluída. Tente novamente ou configure a entrega própria.");
    params.delete("shipping_connected");
    params.delete("shipping_error");
    const query = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
  }, []);

  useEffect(() => {
    if (onboardingState?.completed === false && !shipping.loading && !shipping.ready) {
      setCurrentStep(step => step > 3 ? 3 : step);
    }
  }, [onboardingState?.completed, shipping.loading, shipping.ready]);

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
      throw err;
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

  // Frete must have an active delivery method before continuing.
  function advanceFromShipping() {
    if (!shipping.ready) return;
    setMessage(null);
    setFieldErrors({});
    setCurrentStep(4);
  }

  async function completeWhatsAppStep() {
    setBusy(true);
    setMessage(null);
    try {
    await markOnboardingStep("whatsapp");
    if (isGrowthPlus) {
      setCurrentStep(6);
    } else {
      // No AI step for this plan — finish() marks ai_engine to satisfy the
      // required step set.
      await finish();
    }
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  // Step 6 (Motor de IA) is Growth+ only; lower plans skip it entirely.
  const isGrowthPlus = plan === "growth" || plan === "scale";
  useEffect(() => {
    if (plan === "starter") setCurrentStep(step => Math.min(step, 5));
  }, [plan]);
  const visibleSteps = isGrowthPlus ? STEPS : STEPS.slice(0, 5);
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
    advanceFromShipping,
    shipping,
    completeWhatsAppStep,
    finish,
    goBack,
    retryLoad: () => setLoadAttempt(attempt => attempt + 1),
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
