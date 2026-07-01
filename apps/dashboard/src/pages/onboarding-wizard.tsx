import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Rocket, Sparkles } from "lucide-react";
import {
  createDashboardApi,
  DashboardHttpError,
  type EmbedSessionResponse,
  type MerchantProfile,
  type OnboardingStateResponse,
  type OnboardingStepId,
} from "../api-client.js";
import type { CheckoutSettingsMode, MerchantRules, MerchantTheme } from "@zyon/shared-types";
import { LivePreviewPanel, type LivePreviewPanelRef } from "../components/LivePreviewPanel.js";

const EMBED_SCOPES = ["checkout:start", "checkout:track", "checkout:chat", "offers:apply", "coupons:apply", "payment:intents:create"];

const STEP_LABELS: Record<number, string> = {
  1: "Identidade",
  2: "Descontos",
  3: "Checkout",
  4: "Integração",
};

function errorText(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 160);
  return e instanceof Error ? e.message : String(e);
}

// ── Step 1 state ──────────────────────────────────────────────────────────────

type ThemeDraft = Pick<MerchantTheme, "accentColor" | "logoUrl" | "headerTitle" | "agentName">;

const DEFAULT_THEME_DRAFT: ThemeDraft = {
  accentColor: "#0F766E",
  logoUrl: "",
  headerTitle: "",
  agentName: "",
};

// ── Step 2 state ──────────────────────────────────────────────────────────────

type RulesDraft = Pick<MerchantRules, "maxDiscountPercent" | "minimumMarginPercent" | "allowFreeShipping">;

const DEFAULT_RULES_DRAFT: RulesDraft = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
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

// ─────────────────────────────────────────────────────────────────────────────

export function OnboardingWizard(props: {
  apiBaseUrl: string;
  me: MerchantProfile;
  onNavigate: (tab: "settings" | "rules" | "theme" | "embed") => void;
  onFinished: () => void;
}) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);

  // onboarding state (server-side progress)
  const [onboardingState, setOnboardingState] = useState<OnboardingStateResponse | null>(null);

  // wizard UI step (1–4, independent from server step)
  const [currentStep, setCurrentStep] = useState(1);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // step drafts
  const [themeDraft, setThemeDraft] = useState<ThemeDraft>(DEFAULT_THEME_DRAFT);
  const [rulesDraft, setRulesDraft] = useState<RulesDraft>(DEFAULT_RULES_DRAFT);
  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutDraft>(DEFAULT_CHECKOUT_DRAFT);
  const [embedSession, setEmbedSession] = useState<EmbedSessionResponse | null>(null);

  const previewRef = useRef<LivePreviewPanelRef>(null);

  // load onboarding state on mount
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await api.getOnboardingState();
        if (active) setOnboardingState(s);
      } catch (e) {
        if (active) setMessage(errorText(e));
      }
    })();
    return () => { active = false; };
  }, [api]);

  // load existing theme/rules/checkout to pre-fill drafts
  useEffect(() => {
    void (async () => {
      try {
        const [theme, rules, settings] = await Promise.all([
          api.getMerchantTheme(),
          api.getMerchantRules(),
          api.getCheckoutSettings(),
        ]);
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
        });
        setCheckoutDraft({
          mode: settings.mode,
          openWidgetOnTrigger: settings.widgetBehavior?.openWidgetOnTrigger ?? true,
        });
      } catch {
        // ignore — drafts stay at defaults
      }
    })();
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
    setBusy(true);
    setMessage(null);
    try {
      const current = await api.getMerchantTheme();
      await api.putMerchantTheme({ ...current, ...themeDraft });
      await markOnboardingStep("account");
      previewRef.current?.postThemeUpdate(themeDraft);
      setCurrentStep(2);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep2() {
    setBusy(true);
    setMessage(null);
    try {
      const current = await api.getMerchantRules();
      await api.putMerchantRules({ ...current, ...rulesDraft });
      await markOnboardingStep("checkout_config");
      setCurrentStep(3);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveStep3() {
    setBusy(true);
    setMessage(null);
    try {
      await api.patchCheckoutSettings({
        mode: checkoutDraft.mode,
        widgetBehavior: { openWidgetOnTrigger: checkoutDraft.openWidgetOnTrigger },
      });
      setCurrentStep(4);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function issueEmbed() {
    setBusy(true);
    setMessage(null);
    try {
      const issued = await api.createEmbedSession({ ttl_seconds: 900, scopes: EMBED_SCOPES });
      setEmbedSession(issued);
      await markOnboardingStep("embed");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await markOnboardingStep("publish");
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
    props.onFinished();
  }

  if (!onboardingState) {
    return <p className="page-lead">{message ?? "Carregando onboarding..."}</p>;
  }

  if (onboardingState.completed && currentStep < 4) {
    return (
      <section className="panel stacked" style={{ maxWidth: 520, margin: "0 auto", textAlign: "center", padding: 40 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <span className="badge ok" style={{ fontSize: 13, padding: "6px 14px" }}>
            <Sparkles size={14} style={{ marginRight: 6 }} />
            Onboarding concluído
          </span>
        </div>
        <h2 style={{ marginBottom: 8 }}>Tudo pronto, {props.me.name}.</h2>
        <p className="page-lead" style={{ marginBottom: 24 }}>
          Seu checkout assistido está no ar e pronto para converter.
        </p>
        <button type="button" className="primary-action" onClick={props.onFinished}>
          <Rocket size={15} />
          Ir para o painel
        </button>
      </section>
    );
  }

  const snippet = embedSession
    ? `<script defer src="${props.apiBaseUrl}/widget/aacp.js"></script>\n<zyon-checkout-agent\n  embed-session-token="${embedSession.embed_session_token}"\n  api-base-url="${props.apiBaseUrl}"\n></zyon-checkout-agent>`
    : null;

  return (
    <section className="panel stacked">
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Primeiros passos</h1>
          <p className="page-lead">Configure sua loja em 4 etapas guiadas.</p>
        </div>
      </header>

      {/* Progress indicator */}
      <div className="wizard-progress">
        {([1, 2, 3, 4] as const).map((n) => (
          <React.Fragment key={n}>
            <div
              className={`wizard-step${n === currentStep ? " active" : n < currentStep ? " done" : ""}`}
            >
              <span>{n < currentStep ? <Check size={14} strokeWidth={2.5} /> : n}</span>
              <label>{STEP_LABELS[n]}</label>
            </div>
            {n < 4 && <div className="wizard-connector" />}
          </React.Fragment>
        ))}
      </div>

      {message ? <p className="panel panel-info">{message}</p> : null}

      {/* Step body */}
      <div className="wizard-body">

        {/* ── Step 1 — Identidade da Loja ───────────────────────────────── */}
        {currentStep === 1 && (
          <div className="wizard-columns">
            <div className="wizard-controls">
              <h2>Identidade da Loja</h2>
              <p className="page-lead" style={{ marginBottom: 20 }}>
                Personalize a aparência do widget.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label className="field-label">Cor de destaque</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="color"
                      value={themeDraft.accentColor}
                      onChange={(e) => setThemeDraft((d) => ({ ...d, accentColor: e.target.value }))}
                      style={{ width: 40, height: 36, padding: 2, borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-data)",
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {themeDraft.accentColor}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="field-label">URL do logotipo</label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={themeDraft.logoUrl ?? ""}
                    onChange={(e) => setThemeDraft((d) => ({ ...d, logoUrl: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="field-label">Título do cabeçalho</label>
                  <input
                    type="text"
                    placeholder="Ex: Loja XYZ"
                    value={themeDraft.headerTitle ?? ""}
                    onChange={(e) => setThemeDraft((d) => ({ ...d, headerTitle: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="field-label">Nome do agente</label>
                  <input
                    type="text"
                    placeholder="Ex: Zara"
                    value={themeDraft.agentName ?? ""}
                    onChange={(e) => setThemeDraft((d) => ({ ...d, agentName: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="wizard-preview">
              <LivePreviewPanel ref={previewRef} apiBaseUrl={props.apiBaseUrl} me={props.me} />
            </div>
          </div>
        )}

        {/* ── Step 2 — Regras de Desconto ───────────────────────────────── */}
        {currentStep === 2 && (
          <div className="wizard-columns">
            <div className="wizard-controls">
              <h2>Regras de Desconto</h2>
              <p className="page-lead" style={{ marginBottom: 20 }}>
                Defina os limites de desconto do agente.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div>
                  <label className="field-label">
                    Desconto máximo
                    <span
                      className="badge ok"
                      style={{ marginLeft: 8, fontFamily: "var(--font-data)", fontSize: 11 }}
                    >
                      {rulesDraft.maxDiscountPercent}%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={rulesDraft.maxDiscountPercent}
                    onChange={(e) =>
                      setRulesDraft((d) => ({ ...d, maxDiscountPercent: Number(e.target.value) }))
                    }
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--color-text-faint)", fontFamily: "var(--font-data)" }}>0%</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-faint)", fontFamily: "var(--font-data)" }}>30%</span>
                  </div>
                </div>

                <div>
                  <label className="field-label">
                    Margem mínima
                    <span
                      className="badge warn"
                      style={{ marginLeft: 8, fontFamily: "var(--font-data)", fontSize: 11 }}
                    >
                      {rulesDraft.minimumMarginPercent}%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={60}
                    step={1}
                    value={rulesDraft.minimumMarginPercent}
                    onChange={(e) =>
                      setRulesDraft((d) => ({ ...d, minimumMarginPercent: Number(e.target.value) }))
                    }
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--color-text-faint)", fontFamily: "var(--font-data)" }}>20%</span>
                    <span style={{ fontSize: 11, color: "var(--color-text-faint)", fontFamily: "var(--font-data)" }}>60%</span>
                  </div>
                </div>

                <label className="toggle-row">
                  <span>Frete grátis permitido</span>
                  <input
                    type="checkbox"
                    checked={rulesDraft.allowFreeShipping}
                    onChange={(e) =>
                      setRulesDraft((d) => ({ ...d, allowFreeShipping: e.target.checked }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="wizard-preview">
              <LivePreviewPanel apiBaseUrl={props.apiBaseUrl} me={props.me} />
            </div>
          </div>
        )}

        {/* ── Step 3 — Comportamento do Checkout ────────────────────────── */}
        {currentStep === 3 && (
          <div className="wizard-columns">
            <div className="wizard-controls">
              <h2>Comportamento do Checkout</h2>
              <p className="page-lead" style={{ marginBottom: 20 }}>
                Como o agente intervém no checkout.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label className="field-label">Modo de operação</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                    {(
                      [
                        ["silent_until_trigger", "Silencioso até gatilho"],
                        ["proactive", "Proativo"],
                        ["manual_only", "Somente manual"],
                      ] as [CheckoutSettingsMode, string][]
                    ).map(([value, label]) => (
                      <label key={value} className="radio-row">
                        <input
                          type="radio"
                          name="mode"
                          value={value}
                          checked={checkoutDraft.mode === value}
                          onChange={() => setCheckoutDraft((d) => ({ ...d, mode: value }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <label className="toggle-row" style={{ marginTop: 4 }}>
                  <span>Abrir widget ao detectar gatilho</span>
                  <input
                    type="checkbox"
                    checked={checkoutDraft.openWidgetOnTrigger}
                    onChange={(e) =>
                      setCheckoutDraft((d) => ({ ...d, openWidgetOnTrigger: e.target.checked }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="wizard-preview">
              <LivePreviewPanel apiBaseUrl={props.apiBaseUrl} me={props.me} />
            </div>
          </div>
        )}

        {/* ── Step 4 — Integração ───────────────────────────────────────── */}
        {currentStep === 4 && (
          <div className="wizard-columns">
            <div className="wizard-controls">
              <h2>Integração (Embed)</h2>
              <p className="page-lead" style={{ marginBottom: 20 }}>
                Copie o snippet e cole no <code>&lt;head&gt;</code> da sua loja.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {!embedSession && (
                  <button
                    type="button"
                    className="primary-action"
                    disabled={busy}
                    onClick={() => void issueEmbed()}
                    style={{ alignSelf: "flex-start" }}
                  >
                    {busy ? "Gerando..." : "Gerar snippet"}
                  </button>
                )}

                {snippet && (
                  <div className="panel stacked" style={{ background: "var(--color-surface-raised)", gap: 10 }}>
                    <div className="panel-title">
                      <h3 style={{ fontSize: 13, fontWeight: 600 }}>Snippet de integração</h3>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(snippet)}
                        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}
                      >
                        <Copy size={13} />
                        Copiar
                      </button>
                    </div>
                    <pre
                      className="mono-textarea"
                      style={{
                        margin: 0,
                        padding: "12px 14px",
                        fontSize: 12,
                        lineHeight: 1.6,
                        overflowX: "auto",
                        whiteSpace: "pre",
                        userSelect: "all",
                      }}
                    >
                      <code>{snippet}</code>
                    </pre>
                    <span className="badge ok" style={{ alignSelf: "flex-start", fontSize: 11 }}>
                      Token válido por 15 min
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="wizard-preview">
              <LivePreviewPanel apiBaseUrl={props.apiBaseUrl} me={props.me} />
            </div>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="wizard-footer">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {currentStep > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setCurrentStep((s) => s - 1)}
            >
              ← Voltar
            </button>
          )}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              cursor: "pointer",
              fontSize: 13,
              padding: "6px 8px",
            }}
            onClick={props.onFinished}
          >
            Pular
          </button>
        </div>

        {currentStep === 1 && (
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => void saveStep1()}
          >
            {busy ? "Salvando..." : "Próximo →"}
          </button>
        )}
        {currentStep === 2 && (
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => void saveStep2()}
          >
            {busy ? "Salvando..." : "Próximo →"}
          </button>
        )}
        {currentStep === 3 && (
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => void saveStep3()}
          >
            {busy ? "Salvando..." : "Próximo →"}
          </button>
        )}
        {currentStep === 4 && (
          <button
            type="button"
            className="primary-action"
            disabled={busy}
            onClick={() => void finish()}
          >
            <Rocket size={15} />
            {busy ? "Finalizando..." : "Ir para o painel"}
          </button>
        )}
      </div>
    </section>
  );
}
