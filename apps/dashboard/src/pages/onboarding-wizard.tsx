import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Palette,
  Percent,
  Rocket,
  ShieldCheck,
  Sparkles,
  Code2,
  type LucideIcon,
} from "lucide-react";
import {
  type EmbedSessionResponse,
  type MerchantProfile,
  type OnboardingStateResponse,
  type OnboardingStepId,
} from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import type { CheckoutSettingsMode, MerchantRules, MerchantTheme } from "@zyon/shared-types";
import {
  validateThemeDraft,
  validateRulesDraft,
  validateCheckoutDraft,
  friendlyError,
} from "./onboarding-wizard/validation/schemas.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

type StepMeta = {
  id: number;
  label: string;
  caption: string;
  icon: LucideIcon;
};

const STEPS: StepMeta[] = [
  { id: 1, label: "Configure sua loja", caption: "Informe os dados da sua loja para personalizar a experiência do comprador", icon: Palette },
  { id: 2, label: "Personalize o checkout", caption: "Adapte cores, logo e mensagens para combinar com sua marca", icon: Percent },
  { id: 3, label: "Suas credenciais", caption: "Gere sua API Key para integrar o checkout", icon: ShieldCheck },
  { id: 4, label: "Conecte sua plataforma", caption: "Escolha onde sua loja está hospedada", icon: Code2 },
];

const TOTAL_STEPS = STEPS.length;


// ── Step 1 state ──────────────────────────────────────────────────────────────

type ThemeDraft = Pick<MerchantTheme, "accentColor" | "logoUrl" | "headerTitle" | "agentName">;

const DEFAULT_THEME_DRAFT: ThemeDraft = {
  accentColor: "#0F766E",
  logoUrl: "",
  headerTitle: "",
  agentName: "Assistente Zyon",
};

// ── Step 2 state ──────────────────────────────────────────────────────────────

type RulesDraft = Pick<MerchantRules, "maxDiscountPercent" | "minimumMarginPercent" | "allowFreeShipping"> & { originZip: string };

const DEFAULT_RULES_DRAFT: RulesDraft = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
  originZip: "",
};

// ── Step 3 state ──────────────────────────────────────────────────────────────

type CheckoutDraft = {
  mode: CheckoutSettingsMode;
  openWidgetOnTrigger: boolean;
};

const DEFAULT_CHECKOUT_DRAFT: CheckoutDraft = {
  mode: "silent_until_trigger",
  openWidgetOnTrigger: true,
};

const CHECKOUT_MODE_OPTIONS: [CheckoutSettingsMode, string, string][] = [
  ["silent_until_trigger", "Silencioso até intenção de compra", "Aguarda um sinal de intenção antes de aparecer."],
  ["proactive", "Proativo", "Aparece em momentos-chave do checkout para ajudar o comprador."],
  ["manual_only", "Somente quando acionado", "Só aparece quando o comprador clica no widget."],
];

// ─────────────────────────────────────────────────────────────────────────────

export function OnboardingWizard(props: {
  apiBaseUrl: string;
  me: MerchantProfile;
  onNavigate: (tab: "settings" | "rules" | "theme" | "embed") => void;
  onFinished: () => void;
}) {
  const api = useApi();

  // onboarding state (server-side progress)
  const [onboardingState, setOnboardingState] = useState<OnboardingStateResponse | null>(null);

  // Persist drafts in localStorage so refresh doesn't lose progress
  const STORAGE_KEY = `onb_draft_${props.me.id}`;
  function loadDrafts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* corrupted */ }
    return null;
  }
  const saved = loadDrafts();

  // wizard UI step (1–4, independent from server step)
  const [currentStep, setCurrentStep] = useState(saved?.step ?? 1);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // step drafts
  const [themeDraft, setThemeDraft] = useState<ThemeDraft>(saved?.theme ?? { ...DEFAULT_THEME_DRAFT, headerTitle: props.me.name });
  const [rulesDraft, setRulesDraft] = useState<RulesDraft>(saved?.rules ?? DEFAULT_RULES_DRAFT);
  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutDraft>(saved?.checkout ?? DEFAULT_CHECKOUT_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generatedApiKey, setGeneratedApiKey] = useState<{ id: string; secretKey: string; name: string } | null>(null);

  // persist to localStorage on every draft/step change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, theme: themeDraft, rules: rulesDraft, checkout: checkoutDraft }));
  }, [currentStep, themeDraft, rulesDraft, checkoutDraft]);


  // load onboarding state on mount
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

  // load existing theme/rules/checkout to pre-fill drafts (only if no localStorage draft)
  useEffect(() => {
    if (saved) return;
    let active = true;
    void (async () => {
      try {
        const [theme, rules, settings] = await Promise.all([
          api.getMerchantTheme(),
          api.getMerchantRules(),
          api.getCheckoutSettings(),
        ]);
        if (!active) return;
        setThemeDraft({
          accentColor: theme.accentColor ?? DEFAULT_THEME_DRAFT.accentColor,
          logoUrl: theme.logoUrl ?? "",
          headerTitle: theme.headerTitle ?? "",
          agentName: theme.agentName ?? "",
        });
        setRulesDraft({
          maxDiscountPercent: rules.maxDiscountPercent,
          minimumMarginPercent: rules.minimumMarginPercent,
          allowFreeShipping: rules.allowFreeShipping,
          originZip: rules.originZip ?? "",
        });
        setCheckoutDraft({
          mode: settings.mode,
          openWidgetOnTrigger: settings.widgetBehavior?.openWidgetOnTrigger ?? true,
        });
      } catch {
        // ignore — drafts stay at defaults
      }
    })();
    return () => { active = false; };
  }, [api]);

  async function markOnboardingStep(step: OnboardingStepId) {
    try {
      const next = await api.completeOnboardingStep(step);
      setOnboardingState(next);
    } catch {
      // non-blocking — wizard continues
    }
  }

  async function saveStep1() {
    const errors = validateThemeDraft(themeDraft);
    if (errors.length > 0) {
      setFieldErrors(Object.fromEntries(errors.filter((e): e is { valid: false; field: string; message: string } => !e.valid).map((e) => [e.field, e.message])));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setMessage(null);
    try {
      let current: Record<string, unknown> = {};
      try { current = await api.getMerchantTheme() as Record<string, unknown>; } catch {}
      const payload = { ...current, ...themeDraft };
      if (payload.logoUrl && String(payload.logoUrl).startsWith("blob:")) payload.logoUrl = "";
      await api.putMerchantTheme(payload);
      await markOnboardingStep("account");
      setCurrentStep(2);
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep2() {
    const errors = validateRulesDraft(rulesDraft);
    if (errors.length > 0) {
      setFieldErrors(Object.fromEntries(errors.filter((e): e is { valid: false; field: string; message: string } => !e.valid).map((e) => [e.field, e.message])));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    setMessage(null);
    try {
      let current: Record<string, unknown> = {};
      try { current = await api.getMerchantRules() as Record<string, unknown>; } catch {}
      const merged = { ...current, ...rulesDraft };
      const clamp = (v: unknown, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
      merged.maxDiscountPercent = clamp(merged.maxDiscountPercent, 0, 100);
      merged.minimumMarginPercent = clamp(merged.minimumMarginPercent, 0, 100);
      merged.freeShippingMinCartValue = clamp(merged.freeShippingMinCartValue, 0, 10000);
      merged.maxPartialShippingDiscount = clamp(merged.maxPartialShippingDiscount, 0, 100);
      merged.maxShippingSubsidy = clamp(merged.maxShippingSubsidy, 0, 500);
      merged.offerExpirationMinutes = clamp(merged.offerExpirationMinutes, 1, 1440);
      await api.putMerchantRules(merged);
      await markOnboardingStep("checkout_config");
      setCurrentStep(3);
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep3() {
    if (generatedApiKey) {
      setCurrentStep(4);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.createIntegrationApiKey({ name: "Onboarding key", scopes: ["checkout:read", "checkout:write", "configuration:read", "embed:sessions:create", "orders:read", "catalog:read", "commerce:read"] });
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
    setCurrentStep((s) => Math.max(1, s - 1));
  }

  if (!onboardingState) {
    return (
      <div className="onb-loading" role="status" aria-live="polite">
        <span className="onb-loading-dot" aria-hidden="true" />
        {message ?? "Preparando sua configuração..."}
        <OnboardingStyles />
      </div>
    );
  }

  // ── Completion celebration ─────────────────────────────────────────────────
  if (onboardingState.completed) {
    return (
      <div className="onb-complete" role="status" aria-live="polite">
        <div className="onb-complete-card">
          <div className="onb-widget-orb" style={{ "--orb-c1": "#0f766e", "--orb-c2": "#0f766ecc", "--orb-c3": "#0f766e66", width: 100, height: 100 } as React.CSSProperties}>
            <div className="onb-widget-orb__halo" />
            <div className="onb-widget-orb__core" />
            <div className="onb-widget-orb__eyes" style={{ gap: 16, flexDirection: "column", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 14 }}>
                <span style={{ width: 12, height: 5, borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.2)" }} />
                <span style={{ width: 12, height: 5, borderRadius: "50%", background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.2)" }} />
              </div>
              <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
                <path d="M4 2c2 6 14 6 16 0" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              </svg>
            </div>
          </div>
          <h1 className="onb-complete-title" style={{ marginTop: 24 }}>Checkout ativo, {props.me.name}!</h1>
          <p className="onb-complete-lead">
            Seu agente de vendas está pronto para converter. Compradores já podem interagir com o checkout assistido na sua loja.
          </p>
          <button type="button" className="onb-cta" onClick={props.onFinished}>
            <span className="onb-cta-face">
              <Rocket size={15} />
              Ir para o painel
            </span>
          </button>
        </div>
        <OnboardingStyles />
      </div>
    );
  }

  const activeMeta = STEPS[currentStep - 1];
  const pct = Math.round(((currentStep - 1) / TOTAL_STEPS) * 100);

  return (
    <div className="onb">
      {/* ── Progress rail ───────────────────────────────────────────────── */}
      <aside className="onb-rail" aria-label="Progresso do onboarding">
        <div className="onb-rail-head">
          <span className="onb-rail-mark" aria-hidden="true">Z</span>
          <div>
            <strong>Ative seu checkout assistido</strong>
            <small>Configure tudo em poucos minutos. Você pode alterar qualquer configuração depois.</small>
          </div>
        </div>

        <div className="onb-rail-meter" aria-hidden="true">
          <span className="onb-rail-meter-fill" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>

        <ol className="onb-rail-steps">
          {STEPS.map((step) => {
            const state =
              step.id < currentStep ? "done" : step.id === currentStep ? "active" : "todo";
            const Icon = step.icon;
            return (
              <li key={step.id} className={`onb-rail-step onb-rail-step-${state}`}>
                <span className="onb-rail-node" aria-hidden="true">
                  {state === "done" ? <Check size={14} strokeWidth={3} /> : <Icon size={15} strokeWidth={2} />}
                </span>
                <span className="onb-rail-text">
                  <span className="onb-rail-index">
                    Etapa {String(step.id).padStart(2, "0")}
                    {state === "done" ? " · concluída" : state === "active" ? " · atual" : ""}
                  </span>
                  <span className="onb-rail-label">{step.label}</span>
                  <span className="onb-rail-caption">{step.caption}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          className="onb-rail-skip"
          onClick={props.onFinished}
          disabled={!onboardingState?.completed}
          title={onboardingState?.completed ? undefined : "Complete todas as etapas antes de prosseguir"}
        >
          Configurar depois
        </button>
      </aside>

      {/* ── Focused step content ────────────────────────────────────────── */}
      <section className="onb-stage" aria-live="polite">
        <header className="onb-stage-head">
          <span className="onb-kicker">
            Etapa {String(currentStep).padStart(2, "0")} de {String(TOTAL_STEPS).padStart(2, "0")}
          </span>
          <h1 className="onb-stage-title">{STEP_TITLE[currentStep]}</h1>
          <p className="onb-stage-lead">{STEP_LEAD[currentStep]}</p>
        </header>

        {message ? (
          <p className="onb-alert" role="alert">{message}</p>
        ) : null}

        <div className="onb-stage-body" key={currentStep}>
          <div className="onb-panel">
            <div className="onb-panel-inner">
              {currentStep === 1 && (
                <div className="onb-fields">
                  <div className="onb-field">
                    <label className="onb-field-label" htmlFor="onb-accent">Cor principal da marca</label>
                    <div className="onb-color-field">
                      <input
                        id="onb-accent"
                        type="color"
                        value={themeDraft.accentColor}
                        onChange={(e) => setThemeDraft((d) => ({ ...d, accentColor: e.target.value }))}
                        className="onb-color-swatch"
                      />
                      <span className="onb-mono">{themeDraft.accentColor}</span>
                    </div>
                    {fieldErrors.accentColor && <span className="onb-field-error">{fieldErrors.accentColor}</span>}
                  </div>

                  <div className="onb-field">
                    <label className="onb-field-label" htmlFor="onb-logo">Logotipo da loja</label>
                    <div
                      style={{
                        border: "2px dashed var(--color-border)",
                        borderRadius: "var(--radius-sm)",
                        padding: "20px",
                        textAlign: "center",
                        cursor: "pointer",
                        transition: "border-color 0.15s",
                        position: "relative",
                      }}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--color-brand)"; }}
                      onDragLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.borderColor = "var(--color-border)";
                        const file = e.dataTransfer.files[0];
                        if (file && file.type.startsWith("image/")) {
                          const url = URL.createObjectURL(file);
                          setThemeDraft((d) => ({ ...d, logoUrl: url }));
                        }
                      }}
                      onClick={() => document.getElementById("onb-logo-file")?.click()}
                    >
                      <input
                        id="onb-logo-file"
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = URL.createObjectURL(file);
                            setThemeDraft((d) => ({ ...d, logoUrl: url }));
                          }
                        }}
                      />
                      {themeDraft.logoUrl ? (
                        <img src={themeDraft.logoUrl} alt="Logo" style={{ maxHeight: 48, maxWidth: "100%", objectFit: "contain" }} />
                      ) : (
                        <span style={{ font: "13px var(--font-sans, 'Manrope', sans-serif)", color: "var(--color-text-muted)" }}>
                          Arraste uma imagem ou clique para selecionar
                        </span>
                      )}
                    </div>
                    {fieldErrors.logoUrl && <span className="onb-field-error">{fieldErrors.logoUrl}</span>}
                  </div>

                  <div className="onb-field">
                    <label className="onb-field-label" htmlFor="onb-header">Nome exibido no widget</label>
                    <input
                      id="onb-header"
                      type="text"
                      placeholder="Ex: Minha Loja Official"
                      value={themeDraft.headerTitle ?? ""}
                      onChange={(e) => setThemeDraft((d) => ({ ...d, headerTitle: e.target.value }))}
                    />
                    {fieldErrors.headerTitle && <span className="onb-field-error">{fieldErrors.headerTitle}</span>}
                  </div>

                  <div className="onb-field">
                    <label className="onb-field-label" htmlFor="onb-agent">Nome do assistente de vendas</label>
                    <input
                      id="onb-agent"
                      type="text"
                      placeholder="Ex: Luna, Max, Sofia"
                      value={themeDraft.agentName ?? ""}
                      onChange={(e) => setThemeDraft((d) => ({ ...d, agentName: e.target.value }))}
                    />
                    {fieldErrors.agentName && <span className="onb-field-error">{fieldErrors.agentName}</span>}
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="onb-fields">
                  <div className="onb-field">
                    <div className="onb-field-header">
                      <label className="onb-field-label" htmlFor="onb-maxdisc">Desconto máximo permitido</label>
                      <span className="onb-value onb-value-ok">{rulesDraft.maxDiscountPercent}%</span>
                    </div>
                    <input
                      id="onb-maxdisc"
                      type="range"
                      min={0}
                      max={30}
                      step={1}
                      value={rulesDraft.maxDiscountPercent}
                      onChange={(e) => setRulesDraft((d) => ({ ...d, maxDiscountPercent: Number(e.target.value) }))}
                      className="onb-range"
                    />
                    <div className="onb-range-scale">
                      <span>0%</span>
                      <span>30%</span>
                    </div>
                    <p className="onb-field-help">Limite que o assistente nunca ultrapassa em uma negociação.</p>
                    {fieldErrors.maxDiscountPercent && <span className="onb-field-error">{fieldErrors.maxDiscountPercent}</span>}
                  </div>

                  <div className="onb-field">
                    <div className="onb-field-header">
                      <label className="onb-field-label" htmlFor="onb-margin">Margem mínima de lucro</label>
                      <span className="onb-value onb-value-warn">{rulesDraft.minimumMarginPercent}%</span>
                    </div>
                    <input
                      id="onb-margin"
                      type="range"
                      min={20}
                      max={60}
                      step={1}
                      value={rulesDraft.minimumMarginPercent}
                      onChange={(e) => setRulesDraft((d) => ({ ...d, minimumMarginPercent: Number(e.target.value) }))}
                      className="onb-range"
                    />
                    <div className="onb-range-scale">
                      <span>20%</span>
                      <span>60%</span>
                    </div>
                    <p className="onb-field-help">Ofertas abaixo dessa margem são recusadas automaticamente pelo assistente.</p>
                    {fieldErrors.minimumMarginPercent && <span className="onb-field-error">{fieldErrors.minimumMarginPercent}</span>}
                  </div>

                  <label className="onb-switch">
                    <span className="onb-switch-text">
                      <strong>Permitir frete grátis</strong>
                      <span>Permite que o assistente ofereça frete grátis como incentivo de conversão.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={rulesDraft.allowFreeShipping}
                      onChange={(e) => setRulesDraft((d) => ({ ...d, allowFreeShipping: e.target.checked }))}
                    />
                    <span className="onb-switch-track" aria-hidden="true" />
                  </label>

                  <div className="onb-field">
                    <span className="onb-field-label">CEP de origem (armazém/loja)</span>
                    <input
                      type="text"
                      className="onb-input"
                      placeholder="01311-100"
                      maxLength={9}
                      value={rulesDraft.originZip}
                      onChange={(e) => setRulesDraft((d) => ({ ...d, originZip: e.target.value.replace(/[^\d-]/g, "") }))}
                    />
                    <p className="onb-field-help">CEP do local de envio dos produtos. Usado para calcular frete corretamente.</p>
                    {fieldErrors.originZip && <span className="onb-field-error">{fieldErrors.originZip}</span>}
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="onb-fields">
                  <div className="onb-field" style={{ padding: 20, background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                    <span className="onb-field-label">Merchant ID</span>
                    <pre style={{ font: "13px 'IBM Plex Mono', monospace", padding: 10, background: "var(--color-bg)", borderRadius: 6, border: "1px solid var(--color-border)", color: "var(--color-text)", margin: "8px 0 0", wordBreak: "break-all" }}>{props.me.id}</pre>
                  </div>

                  {generatedApiKey ? (
                    <div className="onb-field" style={{ padding: 20, background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                      <span className="onb-field-label">API Key gerada</span>
                      <p className="onb-field-help" style={{ margin: "4px 0 8px" }}>Salve estas credenciais — a API Key não será exibida novamente.</p>
                      <pre style={{ font: "12px 'IBM Plex Mono', monospace", padding: 10, background: "var(--color-bg)", borderRadius: 6, border: "1px solid var(--color-brand)", color: "var(--color-brand)", margin: 0, wordBreak: "break-all" }}>{generatedApiKey.secretKey}</pre>
                      <button
                        type="button"
                        className="onb-cta onb-cta-inline"
                        style={{ marginTop: 12 }}
                        onClick={() => {
                          const content = `Zyon Checkout - Credenciais\n================================\nMerchant ID: ${props.me.id}\nAPI Key: ${generatedApiKey.secretKey}\n\nGuarde este arquivo em local seguro.\nA API Key não pode ser recuperada após fechar esta tela.`;
                          const blob = new Blob([content], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "zyon-credenciais.txt";
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <span className="onb-cta-face">Baixar credenciais (.txt)</span>
                      </button>
                    </div>
                  ) : (
                    <div className="onb-field">
                      <p className="onb-field-help">Clique em "Gerar API Key" para criar suas credenciais de integração.</p>
                    </div>
                  )}
                </div>
              )}

              {currentStep === 4 && (
                <div className="onb-fields">
                  <div className="onb-field">
                    <span className="onb-field-label">Onde está sua loja?</span>
                    <div className="onb-options">
                      {([
                        ["woocommerce", "WooCommerce", "Plugin WordPress com instalação automática"],
                        ["shopify", "Shopify", "App nativo para lojas Shopify"],
                        ["nuvemshop", "Nuvemshop", "Integração via app parceiro"],
                        ["tray", "Tray Commerce", "Integração nativa para lojas Tray"],
                        ["custom", "Implementação própria", "Instale via snippet JavaScript no seu site"],
                      ] as const).map(([value, label, help]) => {
                        const selected = checkoutDraft.mode === value;
                        return (
                          <label key={value} className={`onb-option${selected ? " onb-option-on" : ""}`}>
                            <input
                              type="radio"
                              name="platform"
                              value={value}
                              checked={selected}
                              onChange={() => setCheckoutDraft((d) => ({ ...d, mode: value as CheckoutSettingsMode }))}
                            />
                            <span className="onb-option-dot" aria-hidden="true" />
                            <span className="onb-option-text">
                              <strong>{label}</strong>
                              <span>{help}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {checkoutDraft.mode && (
                    <div className="onb-field" style={{ marginTop: 12, padding: "16px", background: "var(--color-surface-raised)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)" }}>
                      {checkoutDraft.mode === "custom" ? (
                        <>
                          <span className="onb-field-label">Snippet de integração</span>
                          <p className="onb-field-help" style={{ marginBottom: 10 }}>
                            Cole este código no <code>&lt;head&gt;</code> do seu site.
                          </p>
                          <pre style={{ font: "12px 'IBM Plex Mono', monospace", padding: 12, background: "var(--color-bg)", borderRadius: 6, border: "1px solid var(--color-border)", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--color-text-secondary)" }}>{`<script defer src="${props.apiBaseUrl}/widget/aacp.js"></script>\n<zyon-checkout-agent\n  merchant-id="${props.me.id}"\n  api-key="${generatedApiKey?.secretKey ?? "SUA_API_KEY"}"\n  api-base-url="${props.apiBaseUrl}"\n></zyon-checkout-agent>`}</pre>
                          <a href={`${props.apiBaseUrl.replace(/\/v1$/, "")}/docs#tag/Embed-sessions`} target="_blank" rel="noopener" style={{ font: "500 12px var(--font-sans)", color: "var(--color-brand)", marginTop: 10, display: "inline-block" }}>
                            Ver documentação Embed Sessions →
                          </a>
                        </>
                      ) : (
                        <>
                          <span className="onb-field-label">Instruções de instalação</span>
                          <ol style={{ font: "13px var(--font-sans)", color: "var(--color-text-secondary)", lineHeight: 1.7, paddingLeft: 18, margin: "8px 0 0" }}>
                            {checkoutDraft.mode === "woocommerce" && (<><li>Baixe o plugin Zyon Checkout na aba Plugins do WordPress</li><li>Ative e vá em WooCommerce → Zyon Checkout</li><li>Insira seu Merchant ID e API Key</li></>)}
                            {checkoutDraft.mode === "shopify" && (<><li>Instale o app Zyon Checkout na Shopify App Store</li><li>Autorize a conexão com sua loja</li><li>O checkout será ativado automaticamente</li></>)}
                            {checkoutDraft.mode === "nuvemshop" && (<><li>Acesse o painel Nuvemshop → Apps → Buscar "Zyon"</li><li>Instale e autorize a integração</li><li>Configure seu Merchant ID nas preferências do app</li></>)}
                            {checkoutDraft.mode === "tray" && (<><li>Acesse o painel Tray → Integrações → Buscar "Zyon"</li><li>Ative a integração e autorize o acesso</li><li>O checkout será configurado automaticamente</li></>)}
                          </ol>
                          <a href={`${props.apiBaseUrl.replace(/\/v1$/, "")}/docs#tag/Installations`} target="_blank" rel="noopener" style={{ font: "500 12px var(--font-sans)", color: "var(--color-brand)", marginTop: 12, display: "inline-block" }}>
                            Ver documentação de integração →
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <aside className="onb-preview">
            <div className="onb-preview-frame">
              <span className="onb-preview-tag">Visualização em tempo real</span>
              <div className="onb-preview-live" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", padding: "28px 20px", background: "#0a0f0a", gap: 14, textAlign: "center", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
                <div className="onb-widget-orb" style={{ "--orb-c1": themeDraft.accentColor, "--orb-c2": themeDraft.accentColor + "cc", "--orb-c3": themeDraft.accentColor + "66" } as React.CSSProperties}>
                  <div className="onb-widget-orb__halo" />
                  <div className="onb-widget-orb__core" />
                  <div className="onb-widget-orb__eyes">
                    <span />
                    <span />
                  </div>
                </div>
                <div style={{ font: "600 9px 'IBM Plex Mono', monospace", letterSpacing: "0.1em", color: themeDraft.accentColor }}>GERENTE DE VENDAS DA LOJA</div>
                <div style={{ font: "700 18px 'Space Grotesk', sans-serif", color: "#f0fdf4", letterSpacing: "-0.02em" }}>Oi, eu sou a Zyon.</div>
                <div style={{ font: "12px/1.5 'Space Grotesk', sans-serif", color: "#6b7280", maxWidth: 240 }}>
                  Eu cuido da sua compra do inicio ao fim: acho a melhor opcao, aplico promocoes, organizo a entrega e finalizo o pagamento com voce.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 260, marginTop: 6 }}>
                  {[
                    { text: "Acho a melhor opçãoo e aplico promoções", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={themeDraft.accentColor} strokeWidth="2"><path d="M12 3l1.5 4.5H18l-3.5 2.5L16 14.5 12 12l-4 2.5 1.5-4.5L6 7.5h4.5z"/></svg> },
                    { text: "Calculo o frete e organizo a entrega", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={themeDraft.accentColor} strokeWidth="2"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
                    { text: "Pago com Pix, cartão ou crypto", icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={themeDraft.accentColor} strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
                  ].map((cap) => (
                    <div key={cap.text} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, background: "#111827", border: "1px solid #1f2937" }}>
                      <div style={{ width: 22, height: 22, borderRadius: 5, background: `${themeDraft.accentColor}20`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                        {cap.icon}
                      </div>
                      <span style={{ font: "500 11px 'Space Grotesk', sans-serif", color: "#e5e7eb" }}>{cap.text}</span>
                    </div>
                  ))}
                </div>
                <div style={{ font: "600 9px 'IBM Plex Mono', monospace", letterSpacing: "0.06em", color: "#4b5563", marginTop: 10 }}>COMO VOCE PREFERE COMPRAR?</div>
                <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: "#111827", border: "1px solid #1f2937", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={themeDraft.accentColor} strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  </div>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: "#111827", border: "1px solid #1f2937", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={themeDraft.accentColor} strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* ── Footer navigation ─────────────────────────────────────────── */}
        <footer className="onb-footer">
          <div className="onb-footer-left">
            {currentStep > 1 ? (
              <button type="button" className="onb-back" disabled={busy} onClick={goBack}>
                <ArrowLeft size={15} />
                Voltar
              </button>
            ) : (
              <span className="onb-footer-hint">Etapa {currentStep} de {TOTAL_STEPS}</span>
            )}
          </div>

          <button
            type="button"
            className="onb-cta"
            disabled={busy}
            onClick={() => {
              if (currentStep === 1) void saveStep1();
              else if (currentStep === 2) void saveStep2();
              else if (currentStep === 3) void saveStep3();
              else void finish();
            }}
          >
            <span className="onb-cta-face">
              {currentStep === TOTAL_STEPS ? <Rocket size={15} /> : null}
              {busy
                ? currentStep === TOTAL_STEPS ? "Finalizando..." : currentStep === 3 && !generatedApiKey ? "Gerando..." : "Salvando..."
                : currentStep === TOTAL_STEPS ? "Finalizar" : currentStep === 3 && !generatedApiKey ? "Gerar API Key" : "Continuar"}
              {!busy && currentStep < TOTAL_STEPS ? <ArrowRight size={15} /> : null}
            </span>
          </button>
        </footer>
        <span className="onb-stage-index" aria-hidden="true">{activeMeta.label}</span>
      </section>

      <OnboardingStyles />
    </div>
  );
}

const STEP_TITLE: Record<number, string> = {
  1: "Configure sua loja",
  2: "Personalize o checkout",
  3: "Suas credenciais",
  4: "Conecte sua plataforma",
};

const STEP_LEAD: Record<number, string> = {
  1: "Informe os dados da sua loja para personalizar a experiência do comprador",
  2: "Adapte cores, logo e mensagens para combinar com sua marca",
  3: "Gere sua API Key para integrar o checkout",
  4: "Escolha onde sua loja está hospedada",
};

// ─────────────────────────────────────────────────────────────────────────────
// Page-specific styles. Built on the existing Precision Command tokens.
// One accent (--color-brand), one radius family, one theme. Motion is
// transform/opacity only and fully disabled under reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

function OnboardingStyles() {
  return (
    <style>{`
      .onb {
        display: grid;
        grid-template-columns: 264px minmax(0, 1fr);
        gap: var(--space-6);
        align-items: start;
        max-width: 1120px;
        margin: 0 auto;
      }

      /* ── Progress rail (double-bezel surface) ──────────────────────── */
      .onb-rail {
        position: sticky;
        top: 20px;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        max-height: calc(100vh - 40px);
        padding: var(--space-4);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
        box-shadow: var(--shadow-sm);
        overflow: hidden;
      }

      .onb-rail-head {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding-bottom: var(--space-4);
        border-bottom: 1px solid var(--color-border);
      }

      .onb-rail-mark {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        border-radius: var(--radius-sm);
        color: #FFFFFF;
        background: var(--color-brand);
        font-size: 15px;
        font-weight: 900;
        letter-spacing: -0.03em;
        box-shadow: 0 2px 8px rgba(15,118,110,0.35);
        flex-shrink: 0;
      }

      .onb-rail-head strong {
        display: block;
        color: var(--color-text);
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .onb-rail-head small {
        display: block;
        margin-top: 2px;
        color: var(--color-text-muted);
        font-size: 12px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 180px;
      }

      .onb-rail-meter {
        height: 4px;
        border-radius: var(--radius-full);
        background: var(--color-border);
        overflow: hidden;
      }

      .onb-rail-meter-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--color-brand), var(--color-brand-light));
        transform-origin: left center;
      }

      .onb-rail-steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px;
      }

      .onb-rail-step {
        position: relative;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: var(--space-3);
        padding: var(--space-3) var(--space-2);
        border-radius: var(--radius-sm);
        transition: background var(--duration-base) var(--ease);
      }

      /* connector line between nodes */
      .onb-rail-step::before {
        content: "";
        position: absolute;
        left: calc(var(--space-2) + 15px);
        top: 30px;
        bottom: 0;
        width: 2px;
        background: var(--color-border);
        transform: translateX(-1px);
        z-index: 0;
      }
      .onb-rail-step:last-child::before { display: none; }
      .onb-rail-step-done::before { background: var(--color-brand); }

      .onb-rail-node {
        z-index: 1;
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        border: 1.5px solid var(--color-border-strong);
        background: var(--color-surface);
        color: var(--color-text-faint);
        transition: background var(--duration-base) var(--ease),
                    border-color var(--duration-base) var(--ease),
                    color var(--duration-base) var(--ease);
      }

      .onb-rail-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }

      .onb-rail-index {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--color-text-faint);
      }

      .onb-rail-label {
        font-size: 13.5px;
        font-weight: 600;
        color: var(--color-text-secondary);
        letter-spacing: -0.01em;
      }

      .onb-rail-caption {
        font-size: 11.5px;
        line-height: 1.4;
        color: var(--color-text-faint);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .onb-rail-step-active {
        background: var(--color-brand-subtle);
        z-index: 1;
      }
      .onb-rail-step-active .onb-rail-node {
        border-color: var(--color-brand);
        color: var(--color-brand);
        box-shadow: 0 0 0 4px var(--color-brand-subtle);
      }
      .onb-rail-step-active .onb-rail-label { color: var(--color-text); }
      .onb-rail-step-active .onb-rail-index { color: var(--color-brand); }

      .onb-rail-step-done .onb-rail-node {
        border-color: var(--color-brand);
        background: var(--color-brand);
        color: #FFFFFF;
      }
      .onb-rail-step-done .onb-rail-label { color: var(--color-text-secondary); }

      .onb-rail-skip {
        justify-content: center;
        margin-top: var(--space-1);
        border-color: transparent;
        background: transparent;
        color: var(--color-text-muted);
        font-size: 12.5px;
        font-weight: 600;
      }
      .onb-rail-skip:hover:not(:disabled) {
        background: var(--color-bg);
        color: var(--color-text-secondary);
        border-color: var(--color-border);
      }

      /* ── Stage ──────────────────────────────────────────────────────── */
      .onb-stage {
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .onb-stage-head { margin-bottom: var(--space-5); }

      .onb-kicker {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-brand);
      }

      .onb-stage-title {
        margin-top: var(--space-2);
        font-size: 28px;
        font-weight: 700;
        letter-spacing: -0.028em;
        line-height: 1.16;
        color: var(--color-text);
        text-wrap: balance;
      }

      .onb-stage-lead {
        margin-top: var(--space-2);
        max-width: 58ch;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--color-text-secondary);
        text-wrap: pretty;
      }

      .onb-stage-index {
        position: absolute;
        right: 0;
        bottom: -6px;
        font-size: 88px;
        font-weight: 800;
        letter-spacing: -0.05em;
        line-height: 1;
        color: var(--color-text);
        opacity: 0;
        pointer-events: none;
        user-select: none;
        white-space: nowrap;
      }

      .onb-alert {
        margin-bottom: var(--space-5);
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--color-error-border);
        border-radius: var(--radius-sm);
        background: var(--color-error-bg);
        color: var(--color-error);
        font-size: 13px;
        font-weight: 600;
      }

      /* ── Body layout: controls + preview ────────────────────────────── */
      .onb-stage-body {
        display: grid;
        grid-template-columns: minmax(360px, 0.96fr) minmax(280px, 340px);
        gap: var(--space-5);
        align-items: stretch;
        animation: onb-enter 260ms var(--ease) both;
      }

      @keyframes onb-enter {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Double-bezel panel */
      .onb-panel {
        min-height: 424px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
        box-shadow: var(--shadow-sm);
      }
      .onb-panel-inner {
        height: 100%;
        border-radius: inherit;
        background: var(--color-surface-raised);
        padding: var(--space-5);
      }

      .onb-fields { display: flex; flex-direction: column; gap: var(--space-4); }

      .onb-field { display: flex; flex-direction: column; gap: var(--space-2); }

      .onb-field-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }

      .onb-field-label {
        display: block;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--color-text-muted);
      }

      .onb-field-help {
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--color-text-faint);
      }

      .onb-field-error {
        display: block;
        font-size: 12px;
        color: var(--color-error, #DC2626);
        margin-top: 4px;
      }

      .onb-mono {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--color-text-muted);
        font-variant-numeric: tabular-nums;
      }

      .onb-color-field { display: flex; align-items: center; gap: var(--space-3); }

      .onb-color-swatch {
        width: 44px;
        height: 38px;
        min-height: unset;
        padding: 3px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border-strong);
        background: var(--color-surface);
        cursor: pointer;
      }

      .onb-value {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 var(--space-2);
        border-radius: var(--radius-full);
        border: 1px solid var(--color-border);
        background: var(--color-bg);
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--color-text-secondary);
      }
      .onb-value-ok { color: oklch(86% 0.13 150); background: var(--color-success-bg); border-color: var(--color-success-border); }
      .onb-value-warn { color: oklch(88% 0.13 80); background: var(--color-warning-bg); border-color: var(--color-warning-border); }

      .onb-range {
        width: 100%;
        min-height: unset;
        height: 5px;
        padding: 0;
        border: none;
        border-radius: var(--radius-full);
        background: var(--color-border);
        accent-color: var(--color-brand);
        cursor: pointer;
      }

      .onb-range-scale {
        display: flex;
        justify-content: space-between;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--color-text-faint);
      }

      /* ── Switch ─────────────────────────────────────────────────────── */
      .onb-switch {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-4);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        cursor: pointer;
      }
      .onb-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
      .onb-switch-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .onb-switch-text strong { font-size: 13.5px; font-weight: 600; color: var(--color-text); }
      .onb-switch-text span { font-size: 12px; line-height: 1.5; color: var(--color-text-muted); }

      .onb-switch-track {
        position: relative;
        width: 42px;
        height: 24px;
        border-radius: var(--radius-full);
        background: var(--color-border-strong);
        flex-shrink: 0;
        transition: background var(--duration-base) var(--ease);
      }
      .onb-switch-track::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #FFFFFF;
        box-shadow: var(--shadow-sm);
        transition: transform var(--duration-base) var(--ease);
      }
      .onb-switch input:checked ~ .onb-switch-track { background: var(--color-brand); }
      .onb-switch input:checked ~ .onb-switch-track::after { transform: translateX(18px); }
      .onb-switch input:focus-visible ~ .onb-switch-track { outline: 2px solid var(--color-brand-ring); outline-offset: 2px; }

      /* ── Radio options ──────────────────────────────────────────────── */
      .onb-options { display: flex; flex-direction: column; gap: var(--space-2); }

      .onb-option {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: start;
        gap: var(--space-3);
        padding: var(--space-4);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        cursor: pointer;
        transition: border-color var(--duration-fast) var(--ease),
                    background var(--duration-fast) var(--ease);
      }
      .onb-option:hover { border-color: var(--color-border-strong); }
      .onb-option input { position: absolute; opacity: 0; width: 0; height: 0; }

      .onb-option-dot {
        margin-top: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid var(--color-border-strong);
        background: var(--color-surface);
        flex-shrink: 0;
        transition: border-color var(--duration-fast) var(--ease);
      }
      .onb-option-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .onb-option-text strong { font-size: 13.5px; font-weight: 600; color: var(--color-text); }
      .onb-option-text span { font-size: 12px; line-height: 1.5; color: var(--color-text-muted); }

      .onb-option-on {
        border-color: var(--color-brand);
        background: var(--color-brand-subtle);
        box-shadow: 0 0 0 1px var(--color-brand) inset;
      }
      .onb-option-on .onb-option-dot {
        border-color: var(--color-brand);
        border-width: 5px;
      }
      .onb-option input:focus-visible ~ .onb-option-dot { outline: 2px solid var(--color-brand-ring); outline-offset: 2px; }

      /* ── Embed / snippet ────────────────────────────────────────────── */
      .onb-embed-empty { display: flex; flex-direction: column; gap: var(--space-4); align-items: flex-start; }

      .onb-snippet {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        border: 1px solid #1E293B;
        border-radius: var(--radius-md);
        overflow: hidden;
        background: #0F172A;
        padding: var(--space-3) var(--space-4) var(--space-4);
      }
      .onb-snippet-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
      .onb-snippet-title {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        color: #CBD5E1;
        font-size: 12px;
        font-weight: 600;
      }
      .onb-copy {
        min-height: 28px;
        padding: 0 var(--space-3);
        color: #E2E8F0;
        background: #1E293B;
        border-color: #334155;
        font-size: 12px;
      }
      .onb-copy:hover:not(:disabled) { background: #273549; border-color: #475569; color: #FFFFFF; }
      .onb-snippet-code {
        margin: 0;
        padding: var(--space-3);
        border-radius: var(--radius-sm);
        background: #0B1220;
        color: #E2E8F0;
        font-family: var(--font-mono);
        font-size: 12px;
        line-height: 1.6;
        overflow-x: auto;
        white-space: pre;
        user-select: all;
      }
      .onb-snippet-ttl { align-self: flex-start; }

      .onb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .onb-dot-live { background: var(--color-brand-light); box-shadow: 0 0 0 3px rgba(20,184,166,0.22); }

      /* ── Live preview column ────────────────────────────────────────── */
      .onb-preview { position: sticky; top: 20px; }
      .onb-preview-frame {
        position: relative;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
        box-shadow: var(--shadow-sm);
        padding: var(--space-3);
        overflow: hidden;
      }
      .onb-preview-tag {
        display: inline-flex;
        align-items: center;
        margin-bottom: var(--space-2);
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-muted);
      }
      .onb-preview-live {
        max-height: 580px;
      }
      .onb-preview-live > div {
      }

      /* ── Widget Orb (matches real widget pulse-skin) ──────────────── */
      .onb-widget-orb {
        position: relative;
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        animation: onbOrbFloat 6s ease-in-out infinite;
      }
      .onb-widget-orb__halo {
        position: absolute;
        inset: -12px;
        border-radius: 50%;
        background: conic-gradient(from 0deg, var(--orb-c1), var(--orb-c2), var(--orb-c3), var(--orb-c1));
        filter: blur(16px);
        opacity: 0.5;
        animation: onbOrbSpin 13s linear infinite;
      }
      .onb-widget-orb__core {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background:
          radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,0.85), rgba(255,255,255,0) 42%),
          conic-gradient(from 200deg, var(--orb-c1), var(--orb-c2), var(--orb-c3), var(--orb-c1));
        box-shadow: inset 0 0 18px rgba(255,255,255,0.25);
        animation: onbOrbSpin 19s linear infinite;
      }
      .onb-widget-orb__eyes {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        z-index: 1;
      }
      .onb-widget-orb__eyes span {
        width: 8px;
        height: 11px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 6px rgba(0,0,0,0.2);
        animation: onbBlink 3.5s ease-in-out infinite;
      }
      .onb-widget-orb__eyes span:nth-child(2) {
        animation-delay: 0.1s;
      }
      @keyframes onbOrbSpin { to { transform: rotate(360deg); } }
      @keyframes onbOrbFloat {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-4px); }
      }
      @keyframes onbBlink {
        0%, 90%, 100% { transform: scaleY(1); }
        95% { transform: scaleY(0.1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .onb-widget-orb, .onb-widget-orb__halo, .onb-widget-orb__core, .onb-widget-orb__eyes span {
          animation: none;
        }
      }

      /* ── Footer ─────────────────────────────────────────────────────── */
      .onb-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-4);
        margin-top: var(--space-5);
        padding-top: var(--space-4);
        border-top: 1px solid var(--color-border);
      }
      .onb-footer-left { display: flex; align-items: center; }
      .onb-footer-hint {
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--color-text-faint);
        letter-spacing: 0.02em;
      }

      .onb-back {
        color: var(--color-text-secondary);
        background: var(--color-surface);
        border-color: var(--color-border-strong);
        font-weight: 600;
      }

      /* Button-in-button primary CTA */
      .onb-cta {
        position: relative;
        min-height: 44px;
        padding: 0;
        border: none;
        border-radius: var(--radius-sm);
        background: var(--color-brand);
        box-shadow: 0 1px 2px rgba(15,118,110,0.28), 0 4px 14px rgba(15,118,110,0.22);
      }
      .onb-cta-face {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        min-height: 44px;
        padding: 0 var(--space-5);
        border-radius: inherit;
        color: #FFFFFF;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -0.01em;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.12);
        transition: transform var(--duration-fast) var(--ease), filter var(--duration-fast) var(--ease);
      }
      .onb-cta:hover:not(:disabled) .onb-cta-face { filter: brightness(1.06); transform: translateY(-1px); }
      .onb-cta:active:not(:disabled) .onb-cta-face { transform: translateY(0); }
      .onb-cta:focus-visible { outline: 2px solid var(--color-brand-ring); outline-offset: 2px; }
      .onb-cta:disabled { opacity: 0.55; }
      .onb-cta-inline { align-self: flex-start; }

      /* ── Loading ────────────────────────────────────────────────────── */
      .onb-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-3);
        min-height: 320px;
        color: var(--color-text-muted);
        font-size: 14px;
        font-weight: 500;
      }
      .onb-loading-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--color-brand-light);
        animation: onb-pulse 1.4s ease-in-out infinite;
      }
      @keyframes onb-pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.85); }
        50% { opacity: 1; transform: scale(1.15); }
      }

      /* ── Completion celebration ─────────────────────────────────────── */
      .onb-complete {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        padding: var(--space-8) var(--space-4);
      }
      .onb-complete-card {
        position: relative;
        max-width: 520px;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--space-3);
        padding: var(--space-10) var(--space-8);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
        box-shadow: var(--shadow-lg);
        overflow: hidden;
        animation: onb-enter 480ms var(--ease) both;
      }
      .onb-complete-halo {
        position: absolute;
        top: -120px;
        left: 50%;
        width: 320px;
        height: 320px;
        transform: translateX(-50%);
        border-radius: 50%;
        background: radial-gradient(circle, var(--color-brand-subtle), transparent 70%);
        pointer-events: none;
      }
      .onb-complete-seal {
        position: relative;
        z-index: 1;
        width: 76px;
        height: 76px;
        display: grid;
        place-items: center;
        margin-bottom: var(--space-2);
        border-radius: 50%;
        background: var(--color-brand-subtle);
      }
      .onb-complete-seal-inner {
        width: 56px;
        height: 56px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        color: #FFFFFF;
        background: var(--color-brand);
        box-shadow: 0 6px 18px rgba(15,118,110,0.4);
        animation: onb-pop 520ms var(--ease) both;
      }
      @keyframes onb-pop {
        0% { transform: scale(0.4); opacity: 0; }
        60% { transform: scale(1.12); }
        100% { transform: scale(1); opacity: 1; }
      }
      .onb-kicker-ok { color: var(--color-brand); }
      .onb-complete-title {
        position: relative;
        z-index: 1;
        margin-top: var(--space-1);
        font-size: 26px;
        font-weight: 700;
        letter-spacing: -0.03em;
        color: var(--color-text);
      }
      .onb-complete-lead {
        position: relative;
        z-index: 1;
        max-width: 40ch;
        margin-bottom: var(--space-4);
        font-size: 14px;
        line-height: 1.6;
        color: var(--color-text-muted);
      }

      /* ── Responsive ─────────────────────────────────────────────────── */
      @media (max-width: 1080px) {
        .onb-stage-body { grid-template-columns: 1fr; }
        .onb-preview { position: static; order: -1; }
        .onb-preview-frame { }
      }

      @media (max-width: 860px) {
        .onb { grid-template-columns: 1fr; gap: var(--space-6); }
        .onb-rail { position: static; }
        .onb-rail-steps {
          grid-auto-flow: column;
          grid-auto-columns: minmax(0, 1fr);
          overflow-x: auto;
          gap: var(--space-2);
        }
        .onb-rail-step { grid-template-columns: 1fr; justify-items: center; text-align: center; padding: var(--space-2); }
        .onb-rail-step::before { display: none; }
        .onb-rail-caption { display: none; }
        .onb-rail-text { align-items: center; }
        .onb-rail-skip { display: none; }
      }

      @media (max-width: 768px) {
        .onb-stage-title { font-size: 24px; }
        .onb-stage-index { display: none; }
        .onb-panel-inner { padding: var(--space-4); }
      }

      @media (max-width: 560px) {
        .onb-footer { flex-direction: column-reverse; align-items: stretch; }
        .onb-footer-left { justify-content: center; }
        .onb-back, .onb-cta { width: 100%; }
        .onb-back { justify-content: center; }
        .onb-cta-face { justify-content: center; width: 100%; }
      }

      @media (prefers-reduced-motion: reduce) {
        .onb-stage-body,
        .onb-complete-card,
        .onb-complete-seal-inner,
        .onb-loading-dot,
        .onb-rail-meter-fill,
        .onb-cta-face { animation: none !important; transition: none !important; }
      }
    `}</style>
  );
}
