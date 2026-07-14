import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  Save,
  RotateCcw,
  Radio,
  Eye,
  EyeOff,
  Power,
  Bell,
  Minimize2,
  Timer,
  Zap,
  ShieldOff,
  PhoneForwarded,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Activity,
  Gauge,
  Hand,
  MousePointerClick,
} from "lucide-react";
import type {
  CheckoutSettings,
  CheckoutSettingsMode,
  CheckoutSettingsPatch,
  CheckoutTriggerName,
  CheckoutWidgetPosition,
} from "@zyon/shared-types";
import {
  createDashboardApi,
  DashboardHttpError,
  type MerchantProfile as MerchantMeProfile,
} from "../../api-client.js";
import { LivePreviewPanel } from "../../components/LivePreviewPanel.js";
import type { LivePreviewPanelRef } from "../../components/LivePreviewPanel.js";
import "./checkout-settings-page.css";

// ── helpers ─────────────────────────────────────────────────────────────────

function errText(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 160);
  return e instanceof Error ? e.message : String(e);
}

const TRIGGER_LABELS: Record<CheckoutTriggerName, string> = {
  shipping_objection_detected: "Objeção de frete",
  coupon_field_clicked: "Campo de cupom clicado",
  payment_failed: "Pagamento falhou",
  exit_intent_detected: "Intenção de saída detectada",
  idle_30_seconds: "30s sem interação",
};

const TRIGGER_HELP: Record<CheckoutTriggerName, string> = {
  shipping_objection_detected: "Comprador hesita no custo ou prazo de entrega.",
  coupon_field_clicked: "Comprador procura por um cupom de desconto.",
  payment_failed: "A tentativa de pagamento foi recusada ou expirou.",
  exit_intent_detected: "O cursor indica intenção de sair da página.",
  idle_30_seconds: "Nenhuma interação por 30 segundos seguidos.",
};

const ALL_TRIGGERS: CheckoutTriggerName[] = [
  "shipping_objection_detected",
  "coupon_field_clicked",
  "payment_failed",
  "exit_intent_detected",
  "idle_30_seconds",
];

// ── draft state ──────────────────────────────────────────────────────────────

interface Draft {
  mode: CheckoutSettingsMode;
  openWidgetOnTrigger: boolean;
  startMinimized: boolean;
  position: CheckoutWidgetPosition;
  initialDelaySeconds: number;
  minimumAbandonmentScore: number;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  triggers: Record<CheckoutTriggerName, { enabled: boolean; priority: number }>;
  suppressAfterOfferAccepted: boolean;
  respectBuyerOptOut: boolean;
  minimumCartValue: number;
  suppressedSteps: string;
  blockedRegions: string;
  handoffEnabled: boolean;
  handoffMessage: string;
  handoffChannels: Array<"email" | "whatsapp" | "chat">;
  crossSellEnabled: boolean;
}

function settingsToDraft(s: CheckoutSettings): Draft {
  const triggers = Object.fromEntries(
    ALL_TRIGGERS.map((t) => {
      const rule = s.triggerRules.find((r) => r.trigger === t);
      return [t, { enabled: rule?.enabled ?? false, priority: rule?.priority ?? 50 }];
    })
  ) as Draft["triggers"];

  return {
    mode: s.mode,
    openWidgetOnTrigger: s.widgetBehavior.openWidgetOnTrigger,
    startMinimized: s.widgetBehavior.startMinimized,
    position: s.widgetBehavior.position,
    initialDelaySeconds: s.widgetBehavior.initialDelaySeconds,
    minimumAbandonmentScore: s.interventionPolicy.minimumAbandonmentScore,
    cooldownSeconds: s.interventionPolicy.cooldownSeconds,
    maxInterventionsPerSession: s.interventionPolicy.maxInterventionsPerSession,
    triggers,
    suppressAfterOfferAccepted: s.suppressionRules.suppressAfterOfferAccepted,
    respectBuyerOptOut: s.suppressionRules.respectBuyerOptOut,
    minimumCartValue: s.suppressionRules.minimumCartValue ?? 0,
    suppressedSteps: s.suppressionRules.suppressedSteps.join(", "),
    blockedRegions: s.suppressionRules.blockedRegions.join(", "),
    handoffEnabled: s.handoff.enabled,
    handoffMessage: s.handoff.message,
    handoffChannels: s.handoff.channels,
    crossSellEnabled: (s as any).crossSellEnabled ?? false,
  };
}

function draftToPatch(d: Draft): CheckoutSettingsPatch {
  return {
    mode: d.mode,
    widgetBehavior: {
      openWidgetOnTrigger: d.openWidgetOnTrigger,
      startMinimized: d.startMinimized,
      position: d.position,
      initialDelaySeconds: d.initialDelaySeconds,
    },
    interventionPolicy: {
      minimumAbandonmentScore: d.minimumAbandonmentScore,
      cooldownSeconds: d.cooldownSeconds,
      maxInterventionsPerSession: d.maxInterventionsPerSession,
    },
    triggerRules: ALL_TRIGGERS.map((t) => ({
      trigger: t,
      enabled: d.triggers[t].enabled,
      priority: d.triggers[t].priority,
    })),
    suppressionRules: {
      suppressAfterOfferAccepted: d.suppressAfterOfferAccepted,
      respectBuyerOptOut: d.respectBuyerOptOut,
      minimumCartValue: d.minimumCartValue > 0 ? d.minimumCartValue : undefined,
      suppressedSteps: d.suppressedSteps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      blockedRegions: d.blockedRegions
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    handoff: {
      enabled: d.handoffEnabled,
      message: d.handoffMessage,
      channels: d.handoffChannels,
    },
    crossSellEnabled: d.crossSellEnabled,
  } as CheckoutSettingsPatch;
}

// ── defaults (for genuine "Restore defaults") ────────────────────────────────

const DEFAULT_DRAFT: Draft = {
  mode: "silent_until_trigger",
  openWidgetOnTrigger: true,
  startMinimized: true,
  position: "bottom_right",
  initialDelaySeconds: 4,
  minimumAbandonmentScore: 0.6,
  cooldownSeconds: 90,
  maxInterventionsPerSession: 3,
  triggers: {
    shipping_objection_detected: { enabled: true, priority: 70 },
    coupon_field_clicked: { enabled: true, priority: 60 },
    payment_failed: { enabled: true, priority: 90 },
    exit_intent_detected: { enabled: true, priority: 50 },
    idle_30_seconds: { enabled: false, priority: 30 },
  },
  suppressAfterOfferAccepted: true,
  respectBuyerOptOut: true,
  minimumCartValue: 0,
  suppressedSteps: "",
  blockedRegions: "",
  handoffEnabled: false,
  handoffMessage:
    "Vou transferir você para um atendente humano. Um momento, por favor.",
  handoffChannels: ["chat"],
  crossSellEnabled: false,
};

function draftsEqual(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── validation ───────────────────────────────────────────────────────────────

interface ValidationErrors {
  cooldownSeconds?: string;
  maxInterventionsPerSession?: string;
  minimumAbandonmentScore?: string;
}

function validate(d: Draft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (d.cooldownSeconds < 30) errors.cooldownSeconds = "Mínimo: 30 segundos.";
  if (d.maxInterventionsPerSession > 10 || d.maxInterventionsPerSession < 1)
    errors.maxInterventionsPerSession = "Entre 1 e 10.";
  if (d.minimumAbandonmentScore < 0 || d.minimumAbandonmentScore > 1)
    errors.minimumAbandonmentScore = "Entre 0.0 e 1.0.";
  return errors;
}

// ── Mode config ───────────────────────────────────────────────────────────────

const MODE_OPTIONS: {
  value: CheckoutSettingsMode;
  label: string;
  desc: string;
  icon: React.ReactNode;
  isDefault: boolean;
}[] = [
  {
    value: "silent_until_trigger",
    label: "Silencioso até o gatilho",
    desc: "Aguarda um gatilho antes de agir. Recomendado para a maioria dos casos.",
    icon: <Radio size={16} strokeWidth={1.75} />,
    isDefault: true,
  },
  {
    value: "proactive",
    label: "Proativo",
    desc: "Inicia a conversa automaticamente após o atraso inicial configurado.",
    icon: <Eye size={16} strokeWidth={1.75} />,
    isDefault: false,
  },
  {
    value: "manual_only",
    label: "Somente manual",
    desc: "O comprador abre o widget manualmente. Sem intervenções automáticas.",
    icon: <EyeOff size={16} strokeWidth={1.75} />,
    isDefault: false,
  },
];

// ── Section rail primitives ──────────────────────────────────────────────────

function SectionRail({
  icon,
  index,
  title,
  desc,
  aside,
  children,
}: {
  icon: React.ReactNode;
  index: string;
  title: string;
  desc: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="cfg-section">
      <div className="cfg-section-head">
        <div className="cfg-section-mark" aria-hidden="true">
          {icon}
        </div>
        <div className="cfg-section-heading">
          <div className="cfg-section-titlerow">
            <span className="cfg-section-index" aria-hidden="true">
              {index}
            </span>
            <h2>{title}</h2>
          </div>
          <p>{desc}</p>
        </div>
        {aside ? <div className="cfg-section-aside">{aside}</div> : null}
      </div>
      <div className="cfg-section-body">{children}</div>
    </section>
  );
}

// ── Toggle Switch ─────────────────────────────────────────────────────────────

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  id,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={id}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`cfg-switch${checked ? " on" : ""}`}
    >
      <span className="cfg-switch-thumb" />
    </button>
  );
}

// ── Setting row (label + description + control) ──────────────────────────────

function SettingRow({
  id,
  title,
  desc,
  control,
}: {
  id: string;
  title: string;
  desc: string;
  control: React.ReactNode;
}) {
  return (
    <div className="cfg-row">
      <div className="cfg-row-text">
        <strong id={id}>{title}</strong>
        <span>{desc}</span>
      </div>
      <div className="cfg-row-control">{control}</div>
    </div>
  );
}

// ── Slider with live-fill track ──────────────────────────────────────────────

function SliderField({
  label,
  help,
  value,
  min,
  max,
  step,
  disabled,
  display,
  onChange,
  error,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  display: string;
  onChange: (v: number) => void;
  error?: string;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="cfg-slider">
      <div className="cfg-slider-head">
        <label>{label}</label>
        <output className="cfg-value" style={{ color: error ? "var(--color-error)" : undefined }}>
          {display}
        </output>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cfg-range"
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
      />
      {help ? <p className="cfg-help">{help}</p> : null}
      {error ? <p className="cfg-inline-error">{error}</p> : null}
    </div>
  );
}

// ── Numeric stepper field ─────────────────────────────────────────────────────

function NumberField({
  label,
  help,
  value,
  min,
  max,
  disabled,
  onChange,
  error,
  suffix,
}: {
  label: string;
  help?: string;
  value: number;
  min?: number;
  max?: number;
  disabled: boolean;
  onChange: (v: number) => void;
  error?: string;
  suffix?: string;
}) {
  return (
    <div className="cfg-field">
      <label>{label}</label>
      <div className={`cfg-number${error ? " has-error" : ""}`}>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix ? <span className="cfg-number-suffix">{suffix}</span> : null}
      </div>
      {help ? <p className="cfg-help">{help}</p> : null}
      {error ? <p className="cfg-inline-error">{error}</p> : null}
    </div>
  );
}

// ── Activation flow diagram ──────────────────────────────────────────────────

function ActivationFlow({ draft }: { draft: Draft }) {
  const activeTriggers = ALL_TRIGGERS.filter((t) => draft.triggers[t].enabled);
  const scorePct = Math.round(draft.minimumAbandonmentScore * 100);

  const modeNode =
    draft.mode === "silent_until_trigger"
      ? { label: "Gatilho de saída", detail: `${activeTriggers.length} eventos ativos` }
      : draft.mode === "proactive"
      ? { label: "Início automático", detail: `após ${draft.initialDelaySeconds}s na página` }
      : { label: "Abertura manual", detail: "comprador inicia" };

  const nodes = [
    {
      key: "signal",
      icon: <MousePointerClick size={15} strokeWidth={1.75} />,
      label: modeNode.label,
      detail: modeNode.detail,
    },
    {
      key: "score",
      icon: <Gauge size={15} strokeWidth={1.75} />,
      label: "Avalia abandono",
      detail: draft.mode === "manual_only" ? "ignorado" : `score ≥ ${scorePct}%`,
      dim: draft.mode === "manual_only",
    },
    {
      key: "guard",
      icon: <Timer size={15} strokeWidth={1.75} />,
      label: "Verifica limites",
      detail: `cooldown ${draft.cooldownSeconds}s · máx ${draft.maxInterventionsPerSession}`,
    },
    {
      key: "act",
      icon: <Zap size={15} strokeWidth={1.75} />,
      label: "Agente intervém",
      detail: draft.openWidgetOnTrigger ? "abre o widget" : "sinaliza discreto",
      accent: true,
    },
  ];

  return (
    <div className="cfg-flow" role="img" aria-label="Fluxo de ativação do agente no checkout">
      {nodes.map((n, i) => (
        <React.Fragment key={n.key}>
          <div className={`cfg-flow-node${n.accent ? " accent" : ""}${n.dim ? " dim" : ""}`}>
            <div className="cfg-flow-icon">{n.icon}</div>
            <div className="cfg-flow-text">
              <strong>{n.label}</strong>
              <span>{n.detail}</span>
            </div>
          </div>
          {i < nodes.length - 1 ? (
            <div className="cfg-flow-link" aria-hidden="true">
              <ArrowRight size={14} strokeWidth={2} />
            </div>
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="split-panel">
      <div className="split-panel-controls">
        <div className="skeleton" style={{ height: 118, borderRadius: "var(--radius-lg)" }} />
        {[210, 250, 300, 220].map((h, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ height: h, borderRadius: "var(--radius-md)" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <div className="skeleton" style={{ height: 480, borderRadius: "var(--radius-md)" }} />
      </div>
    </div>
  );
}

// ── component ────────────────────────────────────────────────────────────────

export function CheckoutSettingsPage(props: {
  apiBaseUrl: string;
  me: MerchantMeProfile | null;
}) {
  const api = useMemo(
    () => createDashboardApi({ baseUrl: props.apiBaseUrl }),
    [props.apiBaseUrl]
  );

  const [settings, setSettings] = useState<CheckoutSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);

  const previewRef = useRef<LivePreviewPanelRef>(null);

  useEffect(() => {
    if (!props.me) {
      setSettings(null);
      setDraft(null);
      setSavedDraft(null);
      setMessage(null);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.me]);

  async function load() {
    setBusy(true);
    try {
      const s = await api.getCheckoutSettings();
      const d = settingsToDraft(s);
      setSettings(s);
      setDraft(d);
      setSavedDraft(d);
      setMessage(null);
    } catch (e) {
      setSettings(null);
      setMessage({ text: `Erro ao carregar: ${errText(e)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const errors = validate(draft);
    if (Object.keys(errors).length > 0) {
      setMessage({ text: "Corrija os erros antes de salvar.", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const s = await api.patchCheckoutSettings(draftToPatch(draft));
      const d = settingsToDraft(s);
      setSettings(s);
      setDraft(d);
      setSavedDraft(d);
      setMessage({ text: "Alterações salvas.", kind: "info" });
      previewRef.current?.reload();
    } catch (e) {
      setMessage({ text: `Erro ao salvar: ${errText(e)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function restoreDefaults() {
    if (
      !window.confirm(
        "Restaurar todos os valores para o padrão recomendado? Você ainda precisa salvar para aplicar."
      )
    )
      return;
    setDraft({ ...DEFAULT_DRAFT, triggers: { ...DEFAULT_DRAFT.triggers } });
    setMessage({
      text: "Padrões restaurados no formulário. Revise e salve para aplicar.",
      kind: "info",
    });
  }

  function discardChanges() {
    if (!savedDraft) return;
    setDraft({ ...savedDraft, triggers: { ...savedDraft.triggers } });
    setMessage(null);
  }

  function patchDraft(partial: Partial<Draft>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function patchTrigger(
    trigger: CheckoutTriggerName,
    partial: Partial<{ enabled: boolean; priority: number }>
  ) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        triggers: {
          ...prev.triggers,
          [trigger]: { ...prev.triggers[trigger], ...partial },
        },
      };
    });
  }

  function toggleHandoffChannel(ch: "email" | "whatsapp" | "chat") {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.handoffChannels.includes(ch);
      return {
        ...prev,
        handoffChannels: has
          ? prev.handoffChannels.filter((c) => c !== ch)
          : [...prev.handoffChannels, ch],
      };
    });
  }

  const dirty = draft && savedDraft ? !draftsEqual(draft, savedDraft) : false;


  // Unsaved changes guard
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Configurações do Checkout</h1>
            <p className="page-lead">
              Login necessário para acessar as configurações de checkout.
            </p>
          </div>
        </header>
      </div>
    );
  }

  const errors = draft ? validate(draft) : {};
  const hasErrors = Object.keys(errors).length > 0;
  const activeTriggers = draft ? ALL_TRIGGERS.filter((t) => draft.triggers[t].enabled).length : 0;
  const modeBadge =
    draft?.mode === "silent_until_trigger"
      ? { cls: "ok", label: "trigger" }
      : draft?.mode === "proactive"
      ? { cls: "warn", label: "proativo" }
      : { cls: "muted", label: "manual" };

  return (
    <div className="dashboard-content cfg-page">
      {/* ── Page Head ── */}
      <header className="page-head cfg-head">
        <div>
          <span className="eyebrow">Atendimento</span>
          <h1>Configurações do Checkout</h1>
          <p className="page-lead">
            Defina quando e como o agente intervém durante a compra. As mudanças
            só valem depois de salvas.
          </p>
        </div>
        <div className="cfg-head-actions">
          {dirty ? (
            <span className="cfg-dirty-pill" aria-live="polite">
              <span className="cfg-dirty-dot" />
              Alterações não salvas
            </span>
          ) : settings ? (
            <span className="cfg-saved-meta">
              Salvo {new Date(settings.updatedAt).toLocaleString("pt-BR")}
            </span>
          ) : null}
          <div className="button-row">
            <button type="button" disabled={busy} onClick={() => void load()} title="Busca as configurações salvas no servidor">
              <RefreshCw size={14} strokeWidth={1.75} />
              Recarregar
            </button>
            <button
              type="button"
              className="btn-primary cfg-save"
              disabled={busy || !draft || hasErrors || !dirty}
              onClick={() => void save()}
            >
              <Save size={14} strokeWidth={2} />
              {busy ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Messages ── */}
      {message ? (
        <div className={`cfg-banner ${message.kind === "error" ? "err" : "info"}`} role="status">
          {message.kind === "error" ? (
            <AlertTriangle size={16} strokeWidth={1.75} />
          ) : (
            <CheckCircle2 size={16} strokeWidth={1.75} />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}

      {/* ── Loading ── */}
      {!settings && !message ? <SettingsSkeleton /> : null}

      {/* ── Content ── */}
      {draft ? (
        <div className="split-panel cfg-split">
          <div className="split-panel-controls cfg-controls">
            {/* ── Activation flow diagram ── */}
            <div className="cfg-flow-card">
              <div className="cfg-flow-card-head">
                <div className="cfg-flow-title">
                  <Activity size={15} strokeWidth={1.75} />
                  <span>Quando o agente ativa</span>
                </div>
                <span className={`badge ${modeBadge.cls}`}>{modeBadge.label}</span>
              </div>
              <ActivationFlow draft={draft} />
            </div>

            {/* 1 — Activation */}
            <SectionRail
              icon={<Power size={16} strokeWidth={1.75} />}
              index="01"
              title="Ativação"
              desc="O modo base que decide se o agente age sozinho ou espera."
            >
              <fieldset className="cfg-modes">
                <legend className="sr-only">Modo de ativação</legend>
                {MODE_OPTIONS.map(({ value, label, desc, icon, isDefault }) => {
                  const selected = draft.mode === value;
                  return (
                    <label
                      key={value}
                      className={`cfg-mode${selected ? " selected" : ""}`}
                      data-disabled={busy ? "true" : undefined}
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={value}
                        checked={selected}
                        disabled={busy}
                        onChange={() => patchDraft({ mode: value })}
                      />
                      <span className="cfg-mode-icon">{icon}</span>
                      <span className="cfg-mode-text">
                        <span className="cfg-mode-label">
                          {label}
                          {isDefault ? <span className="cfg-tag">padrão</span> : null}
                        </span>
                        <span className="cfg-mode-desc">{desc}</span>
                      </span>
                      <span className="cfg-mode-check" aria-hidden="true">
                        <CheckCircle2 size={16} strokeWidth={2} />
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </SectionRail>

            {/* 2 — Behavior */}
            <SectionRail
              icon={<Minimize2 size={16} strokeWidth={1.75} />}
              index="02"
              title="Apresentação"
              desc="Como o widget aparece na página do comprador."
            >
              <div className="cfg-rows">
                <SettingRow
                  id="toggle-open-widget"
                  title="Abrir nos gatilhos"
                  desc="Expande automaticamente quando um gatilho dispara."
                  control={
                    <ToggleSwitch
                      id="toggle-open-widget"
                      checked={draft.openWidgetOnTrigger}
                      disabled={busy}
                      onChange={(v) => patchDraft({ openWidgetOnTrigger: v })}
                    />
                  }
                />
                <SettingRow
                  id="toggle-minimized"
                  title="Iniciar minimizado"
                  desc="O widget começa recolhido no canto da página."
                  control={
                    <ToggleSwitch
                      id="toggle-minimized"
                      checked={draft.startMinimized}
                      disabled={busy}
                      onChange={(v) => patchDraft({ startMinimized: v })}
                    />
                  }
                />
              </div>

              <div className="cfg-grid-2">
                <div className="cfg-field">
                  <label htmlFor="cfg-position">Posição na tela</label>
                  <div className="cfg-select">
                    <select
                      id="cfg-position"
                      value={draft.position}
                      disabled={busy}
                      onChange={(e) =>
                        patchDraft({ position: e.target.value as CheckoutWidgetPosition })
                      }
                    >
                      <option value="bottom_right">Inferior direito</option>
                      <option value="bottom_left">Inferior esquerdo</option>
                    </select>
                  </div>
                </div>

                <SliderField
                  label="Delay inicial"
                  help="Tempo antes de o modo proativo começar."
                  value={draft.initialDelaySeconds}
                  min={0}
                  max={30}
                  step={1}
                  disabled={busy}
                  display={`${draft.initialDelaySeconds}s`}
                  onChange={(v) => patchDraft({ initialDelaySeconds: v })}
                />
              </div>
            </SectionRail>

            {/* 3 — Triggers */}
            <SectionRail
              icon={<Bell size={16} strokeWidth={1.75} />}
              index="03"
              title="Gatilhos"
              desc="Eventos do comprador que autorizam uma intervenção."
              aside={
                <span className={`badge ${activeTriggers > 0 ? "ok" : "muted"}`}>
                  {activeTriggers}/{ALL_TRIGGERS.length} ativos
                </span>
              }
            >
              <div className="cfg-triggers">
                {ALL_TRIGGERS.map((t) => {
                  const on = draft.triggers[t].enabled;
                  return (
                    <div key={t} className={`cfg-trigger${on ? " on" : ""}`}>
                      <div className="cfg-trigger-main">
                        <strong id={`trigger-${t}`}>{TRIGGER_LABELS[t]}</strong>
                        <span>{TRIGGER_HELP[t]}</span>
                      </div>
                      <div className="cfg-trigger-controls">
                        <div className="cfg-priority" data-off={on ? undefined : "true"}>
                          <span>Prioridade</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={draft.triggers[t].priority}
                            disabled={busy || !on}
                            aria-label={`Prioridade de ${TRIGGER_LABELS[t]}`}
                            onChange={(e) =>
                              patchTrigger(t, {
                                priority: Math.min(100, Math.max(0, Number(e.target.value))),
                              })
                            }
                          />
                        </div>
                        <ToggleSwitch
                          id={`trigger-${t}`}
                          checked={on}
                          disabled={busy}
                          onChange={(v) => patchTrigger(t, { enabled: v })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionRail>

            {/* 4 — Limits & Suppression */}
            <SectionRail
              icon={<Timer size={16} strokeWidth={1.75} />}
              index="04"
              title="Limites e supressão"
              desc="Barreiras que impedem o agente de ser insistente ou inoportuno."
              aside={hasErrors ? <span className="badge bad">erros</span> : undefined}
            >
              <SliderField
                label="Score mínimo de abandono"
                help="Confiança mínima de que o comprador vai abandonar antes de agir."
                value={draft.minimumAbandonmentScore}
                min={0}
                max={1}
                step={0.05}
                disabled={busy}
                display={`${Math.round(draft.minimumAbandonmentScore * 100)}%`}
                onChange={(v) => patchDraft({ minimumAbandonmentScore: v })}
                error={errors.minimumAbandonmentScore}
              />

              <div className="cfg-grid-2">
                <NumberField
                  label="Cooldown entre intervenções"
                  help={`Espera ≈ ${(draft.cooldownSeconds / 60).toFixed(1)} min entre ações.`}
                  value={draft.cooldownSeconds}
                  min={30}
                  disabled={busy}
                  suffix="s"
                  onChange={(v) => patchDraft({ cooldownSeconds: v })}
                  error={errors.cooldownSeconds}
                />
                <NumberField
                  label="Máximo por sessão"
                  help="Teto de intervenções em uma única visita."
                  value={draft.maxInterventionsPerSession}
                  min={1}
                  max={10}
                  disabled={busy}
                  onChange={(v) => patchDraft({ maxInterventionsPerSession: v })}
                  error={errors.maxInterventionsPerSession}
                />
              </div>

              <div className="cfg-subhead">
                <ShieldOff size={14} strokeWidth={1.75} />
                <span>Regras de supressão</span>
              </div>

              <div className="cfg-rows">
                <SettingRow
                  id="toggle-suppress-offer"
                  title="Suprimir após oferta aceita"
                  desc="Não exibe o widget depois que uma oferta é aceita."
                  control={
                    <ToggleSwitch
                      id="toggle-suppress-offer"
                      checked={draft.suppressAfterOfferAccepted}
                      disabled={busy}
                      onChange={(v) => patchDraft({ suppressAfterOfferAccepted: v })}
                    />
                  }
                />
                <SettingRow
                  id="toggle-optout"
                  title="Respeitar opt-out do comprador"
                  desc="Honra a preferência de não receber intervenções."
                  control={
                    <ToggleSwitch
                      id="toggle-optout"
                      checked={draft.respectBuyerOptOut}
                      disabled={busy}
                      onChange={(v) => patchDraft({ respectBuyerOptOut: v })}
                    />
                  }
                />
              </div>

              <div className="cfg-grid-3">
                <NumberField
                  label="Valor mínimo do carrinho"
                  value={draft.minimumCartValue}
                  min={0}
                  disabled={busy}
                  suffix="R$"
                  onChange={(v) => patchDraft({ minimumCartValue: v })}
                />
                <div className="cfg-field">
                  <label htmlFor="cfg-steps">Etapas suprimidas</label>
                  <div className="cfg-number">
                    <input
                      id="cfg-steps"
                      type="text"
                      value={draft.suppressedSteps}
                      disabled={busy}
                      placeholder="payment, review"
                      onChange={(e) => patchDraft({ suppressedSteps: e.target.value })}
                    />
                  </div>
                </div>
                <div className="cfg-field">
                  <label htmlFor="cfg-regions">Regiões bloqueadas</label>
                  <div className="cfg-number">
                    <input
                      id="cfg-regions"
                      type="text"
                      value={draft.blockedRegions}
                      disabled={busy}
                      placeholder="AM, RR"
                      onChange={(e) => patchDraft({ blockedRegions: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </SectionRail>

            {/* 5 — Handoff */}
            <SectionRail
              icon={<PhoneForwarded size={16} strokeWidth={1.75} />}
              index="05"
              title="Transferência humana"
              desc="Passa a conversa para um atendente quando o agente não resolve."
              aside={
                <span className={`badge ${draft.handoffEnabled ? "ok" : "muted"}`}>
                  {draft.handoffEnabled ? "ativo" : "inativo"}
                </span>
              }
            >
              <div className="cfg-rows">
                <SettingRow
                  id="toggle-handoff"
                  title="Habilitar handoff"
                  desc="Transfere a conversa para um canal humano quando necessário."
                  control={
                    <ToggleSwitch
                      id="toggle-handoff"
                      checked={draft.handoffEnabled}
                      disabled={busy}
                      onChange={(v) => patchDraft({ handoffEnabled: v })}
                    />
                  }
                />
              </div>

              {draft.handoffEnabled ? (
                <div className="cfg-handoff-body">
                  <div className="cfg-field">
                    <label htmlFor="cfg-handoff-msg">Mensagem de transferência</label>
                    <textarea
                      id="cfg-handoff-msg"
                      className="cfg-textarea"
                      value={draft.handoffMessage}
                      disabled={busy}
                      rows={3}
                      onChange={(e) => patchDraft({ handoffMessage: e.target.value })}
                    />
                  </div>

                  <div className="cfg-field">
                    <label>
                      <Hand size={13} strokeWidth={1.75} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                      Canais de saída
                    </label>
                    <div className="chip-row">
                      {(["email", "whatsapp", "chat"] as const).map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          className={`chip ${draft.handoffChannels.includes(ch) ? "selected" : ""}`}
                          disabled={busy}
                          onClick={() => toggleHandoffChannel(ch)}
                        >
                          {ch}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </SectionRail>

            {/* 6 — Cross-sell */}
            <SectionRail
              icon={<Zap size={16} strokeWidth={1.75} />}
              index="06"
              title="Cross-sell"
              desc="Sugira produtos complementares durante o checkout para aumentar o ticket médio."
              aside={
                <span className={`badge ${draft.crossSellEnabled ? "ok" : "muted"}`}>
                  {draft.crossSellEnabled ? "ativo" : "inativo"}
                </span>
              }
            >
              <div className="cfg-rows">
                <SettingRow
                  id="toggle-cross-sell"
                  title="Habilitar cross-sell"
                  desc="O agente sugere produtos relacionados quando o comprador avança para pagamento."
                  control={
                    <ToggleSwitch
                      id="toggle-cross-sell"
                      checked={draft.crossSellEnabled}
                      disabled={busy}
                      onChange={(v) => patchDraft({ crossSellEnabled: v })}
                    />
                  }
                />
              </div>
            </SectionRail>

            {/* Footer actions */}
            <div className="cfg-footer">
              <div className="cfg-footer-left">
                <button type="button" disabled={busy} onClick={restoreDefaults}>
                  <RotateCcw size={14} strokeWidth={1.75} />
                  Restaurar padrões
                </button>
                {dirty ? (
                  <button type="button" className="btn-ghost cfg-discard" disabled={busy} onClick={discardChanges}>
                    Descartar alterações
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="btn-primary cfg-save"
                disabled={busy || hasErrors || !dirty}
                onClick={() => void save()}
              >
                <Save size={14} strokeWidth={2} />
                {busy ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>
          </div>

          {/* ── Preview column ── */}
          <div className="split-panel-preview" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
            {dirty ? (
              <div style={{ padding: "8px 14px", background: "var(--warn-soft)", borderBottom: "1px solid var(--border)", font: "11px var(--mono)", color: "var(--warn)", textAlign: "center" }}>Mostrando configuração salva</div>
            ) : null}
            <LivePreviewPanel ref={previewRef} apiBaseUrl={props.apiBaseUrl} me={props.me} />
          </div>
        </div>
      ) : null}

      {/* ── Page-specific styles ── */}
    </div>
  );
}
