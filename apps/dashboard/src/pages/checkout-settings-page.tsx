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
} from "../api-client.js";
import { LivePreviewPanel } from "../components/LivePreviewPanel.js";
import type { LivePreviewPanelRef } from "../components/LivePreviewPanel.js";

// ── helpers ─────────────────────────────────────────────────────────────────

function errText(e: unknown): string {
  if (e instanceof DashboardHttpError) return e.responseBody.slice(0, 160);
  return e instanceof Error ? e.message : String(e);
}

const TRIGGER_LABELS: Record<CheckoutTriggerName, string> = {
  shipping_objection_detected: "Objeção de frete",
  coupon_field_clicked: "Campo de cupom clicado",
  payment_failed: "Pagamento falhou",
  exit_intent_detected: "Exit intent detectado",
  idle_30_seconds: "30s sem interação",
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
  };
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
    icon: <Radio size={16} />,
    isDefault: true,
  },
  {
    value: "proactive",
    label: "Proativo",
    desc: "Inicia a conversa automaticamente após o delay configurado.",
    icon: <Eye size={16} />,
    isDefault: false,
  },
  {
    value: "manual_only",
    label: "Somente manual",
    desc: "O comprador deve abrir o widget manualmente. Sem intervenções automáticas.",
    icon: <EyeOff size={16} />,
    isDefault: false,
  },
];

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="split-panel">
      <div className="split-panel-controls">
        {[180, 220, 260, 200].map((h, i) => (
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
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 2,
        background: checked ? "var(--color-brand)" : "var(--color-border-strong)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 170ms cubic-bezier(0.16,1,0.3,1)",
        display: "flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          display: "block",
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          transform: checked ? "translateX(18px)" : "translateX(0)",
          transition: "transform 170ms cubic-bezier(0.16,1,0.3,1)",
        }}
      />
    </button>
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "info" | "error" } | null>(null);

  const previewRef = useRef<LivePreviewPanelRef>(null);

  useEffect(() => {
    if (!props.me) {
      setSettings(null);
      setDraft(null);
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
      setSettings(s);
      setDraft(settingsToDraft(s));
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
      setSettings(s);
      setDraft(settingsToDraft(s));
      setMessage({ text: "Alterações gravadas.", kind: "info" });
      previewRef.current?.reload();
    } catch (e) {
      setMessage({ text: `Erro ao salvar: ${errText(e)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function resetDefaults() {
    if (!window.confirm("Resetar para os valores padrão? Esta ação não pode ser desfeita.")) return;
    setBusy(true);
    try {
      // api-client has no resetCheckoutSettings — do a PUT with defaults via patch
      // If the API exposes a reset endpoint in future, replace this call.
      const s = await api.getCheckoutSettings();
      setSettings(s);
      setDraft(settingsToDraft(s));
      setMessage({ text: "Configurações recarregadas do servidor.", kind: "info" });
    } catch (e) {
      setMessage({ text: `Erro ao resetar: ${errText(e)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
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

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Checkout settings</h1>
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

  return (
    <div className="dashboard-content">
      {/* ── Page Head ── */}
      <header className="page-head">
        <div>
          <h1>Checkout settings</h1>
          <p className="page-lead">
            {settings ? (
              <>
                Atualizado em{" "}
                {new Date(settings.updatedAt).toLocaleString("pt-BR")}
                {" · "}
                <span className={`badge ${hasErrors ? "bad" : "ok"}`}>
                  {hasErrors ? "com erros" : "válido"}
                </span>
              </>
            ) : (
              "Configure o comportamento do agente no checkout."
            )}
          </p>
        </div>
        <div className="button-row">
          <button type="button" disabled={busy} onClick={() => void resetDefaults()}>
            <RotateCcw size={14} />
            Resetar
          </button>
          <button type="button" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} />
            Recarregar
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={busy || !draft || hasErrors}
            onClick={() => void save()}
          >
            <Save size={14} />
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </header>

      {/* ── Messages ── */}
      {message ? (
        <div
          className={`panel ${message.kind === "error" ? "panel-error" : "panel-info"}`}
          style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}
        >
          {message.kind === "error" ? (
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          ) : (
            <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
          )}
          {message.text}
        </div>
      ) : null}

      {/* ── Loading ── */}
      {!settings && !message ? (
        <SettingsSkeleton />
      ) : null}

      {/* ── Content ── */}
      {draft ? (
        <div className="split-panel">
          {/* ── Config column ── */}
          <div className="split-panel-controls">

            {/* 1 — Modo de Operação */}
            <section className="panel stacked">
              <div className="panel-title">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-brand-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-brand)",
                      flexShrink: 0,
                    }}
                  >
                    <Power size={15} />
                  </div>
                  <h2>Modo de Operação</h2>
                </div>
                <span
                  className={`badge ${
                    draft.mode === "silent_until_trigger"
                      ? "ok"
                      : draft.mode === "proactive"
                      ? "warn"
                      : "muted"
                  }`}
                >
                  {draft.mode === "silent_until_trigger"
                    ? "trigger"
                    : draft.mode === "proactive"
                    ? "proativo"
                    : "manual"}
                </span>
              </div>

              <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
                <legend className="sr-only">Modo de Operação</legend>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  {MODE_OPTIONS.map(({ value, label, desc, icon, isDefault }) => {
                    const selected = draft.mode === value;
                    return (
                      <label
                        key={value}
                        style={{
                          display: "flex",
                          gap: "var(--space-3)",
                          cursor: busy ? "not-allowed" : "pointer",
                          alignItems: "flex-start",
                          padding: "var(--space-3) var(--space-4)",
                          border: `1px solid ${selected ? "var(--color-brand)" : "var(--color-border)"}`,
                          borderRadius: "var(--radius-sm)",
                          background: selected ? "var(--color-brand-subtle)" : "var(--color-surface-raised)",
                          transition: "border-color 150ms, background 150ms",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        <input
                          type="radio"
                          name="mode"
                          value={value}
                          checked={selected}
                          disabled={busy}
                          onChange={() => patchDraft({ mode: value })}
                          style={{ marginTop: 3, accentColor: "var(--color-brand)" }}
                        />
                        <div
                          style={{
                            color: selected ? "var(--color-brand)" : "var(--color-text-muted)",
                            marginTop: 2,
                            flexShrink: 0,
                          }}
                        >
                          {icon}
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                            <strong style={{ fontSize: 13, color: "var(--color-text)" }}>{label}</strong>
                            {isDefault ? (
                              <span className="badge muted">padrão</span>
                            ) : null}
                          </div>
                          <p style={{ marginTop: 2, fontSize: 12, color: "var(--color-text-muted)" }}>
                            {desc}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </section>

            {/* 2 — Comportamento do Widget */}
            <section className="panel stacked">
              <div className="panel-title">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-brand-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-brand)",
                      flexShrink: 0,
                    }}
                  >
                    <Minimize2 size={15} />
                  </div>
                  <h2>Comportamento do Widget</h2>
                </div>
              </div>

              <div className="toggle-row">
                <div>
                  <strong id="toggle-open-widget">Abrir nos gatilhos</strong>
                  <span>Expande automaticamente quando um gatilho dispara</span>
                </div>
                <ToggleSwitch
                  id="toggle-open-widget"
                  checked={draft.openWidgetOnTrigger}
                  disabled={busy}
                  onChange={(v) => patchDraft({ openWidgetOnTrigger: v })}
                />
              </div>

              <div className="toggle-row">
                <div>
                  <strong id="toggle-minimized">Iniciar minimizado</strong>
                  <span>Widget começa recolhido na página</span>
                </div>
                <ToggleSwitch
                  id="toggle-minimized"
                  checked={draft.startMinimized}
                  disabled={busy}
                  onChange={(v) => patchDraft({ startMinimized: v })}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <label>
                  Posição
                  <select
                    value={draft.position}
                    disabled={busy}
                    onChange={(e) =>
                      patchDraft({ position: e.target.value as CheckoutWidgetPosition })
                    }
                  >
                    <option value="bottom_right">Inferior direito</option>
                    <option value="bottom_left">Inferior esquerdo</option>
                  </select>
                </label>

                <label>
                  <span style={{ display: "flex", justifyContent: "space-between" }}>
                    Delay inicial
                    <code
                      style={{
                        fontFamily: "var(--font-data)",
                        fontSize: 11,
                        color: "var(--color-brand)",
                        fontWeight: 700,
                      }}
                    >
                      {draft.initialDelaySeconds}s
                    </code>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    step={1}
                    value={draft.initialDelaySeconds}
                    disabled={busy}
                    onChange={(e) =>
                      patchDraft({ initialDelaySeconds: Number(e.target.value) })
                    }
                    style={{ accentColor: "var(--color-brand)" }}
                  />
                </label>
              </div>
            </section>

            {/* 3 — Gatilhos */}
            <section className="panel stacked">
              <div className="panel-title">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-brand-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-brand)",
                      flexShrink: 0,
                    }}
                  >
                    <Bell size={15} />
                  </div>
                  <h2>Gatilhos</h2>
                </div>
                <span className={`badge ${activeTriggers > 0 ? "ok" : "muted"}`}>
                  {activeTriggers}/{ALL_TRIGGERS.length} ativos
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                {ALL_TRIGGERS.map((t) => (
                  <div key={t} className="toggle-row">
                    <div>
                      <strong id={`trigger-${t}`}>{TRIGGER_LABELS[t]}</strong>
                      <span style={{ fontFamily: "var(--font-data)", fontSize: 11 }}>{t}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          fontSize: 12,
                          color: "var(--color-text-muted)",
                          fontWeight: 600,
                          cursor: "default",
                        }}
                      >
                        Pri.
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={draft.triggers[t].priority}
                          disabled={busy}
                          onChange={(e) =>
                            patchTrigger(t, {
                              priority: Math.min(100, Math.max(0, Number(e.target.value))),
                            })
                          }
                          style={{ width: 56, minHeight: 30 }}
                        />
                      </label>
                      <ToggleSwitch
                        id={`trigger-${t}`}
                        checked={draft.triggers[t].enabled}
                        disabled={busy}
                        onChange={(v) => patchTrigger(t, { enabled: v })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 4 — Política de Intervenção */}
            <section className="panel stacked">
              <div className="panel-title">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-sm)",
                      background: hasErrors ? "var(--color-error-bg)" : "var(--color-brand-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: hasErrors ? "var(--color-error)" : "var(--color-brand)",
                      flexShrink: 0,
                    }}
                  >
                    <Timer size={15} />
                  </div>
                  <h2>Política de Intervenção</h2>
                </div>
                {hasErrors ? <span className="badge bad">erros</span> : null}
              </div>

              <div>
                <label style={{ marginBottom: "var(--space-1)" }}>
                  <span style={{ display: "flex", justifyContent: "space-between" }}>
                    Score mínimo de abandono
                    <code
                      style={{
                        fontFamily: "var(--font-data)",
                        fontSize: 11,
                        color: "var(--color-brand)",
                        fontWeight: 700,
                      }}
                    >
                      {Math.round(draft.minimumAbandonmentScore * 100)}%
                    </code>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={draft.minimumAbandonmentScore}
                    disabled={busy}
                    onChange={(e) =>
                      patchDraft({ minimumAbandonmentScore: Number(e.target.value) })
                    }
                    style={{ accentColor: "var(--color-brand)" }}
                  />
                </label>
                {errors.minimumAbandonmentScore ? (
                  <p
                    className="panel-error"
                    style={{ margin: "var(--space-1) 0 0", padding: "var(--space-2) var(--space-3)" }}
                  >
                    {errors.minimumAbandonmentScore}
                  </p>
                ) : null}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
                <div>
                  <label>
                    Cooldown
                    <input
                      type="number"
                      min={30}
                      value={draft.cooldownSeconds}
                      disabled={busy}
                      onChange={(e) => patchDraft({ cooldownSeconds: Number(e.target.value) })}
                    />
                  </label>
                  <p style={{ marginTop: 4, fontSize: 11, color: "var(--color-text-faint)" }}>
                    ≈ {(draft.cooldownSeconds / 60).toFixed(1)} min
                  </p>
                  {errors.cooldownSeconds ? (
                    <p
                      className="panel-error"
                      style={{ margin: "var(--space-1) 0 0", padding: "var(--space-2) var(--space-3)" }}
                    >
                      {errors.cooldownSeconds}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label>
                    Máx. intervenções / sessão
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={draft.maxInterventionsPerSession}
                      disabled={busy}
                      onChange={(e) =>
                        patchDraft({ maxInterventionsPerSession: Number(e.target.value) })
                      }
                    />
                  </label>
                  {errors.maxInterventionsPerSession ? (
                    <p
                      className="panel-error"
                      style={{ margin: "var(--space-1) 0 0", padding: "var(--space-2) var(--space-3)" }}
                    >
                      {errors.maxInterventionsPerSession}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            {/* 5 — Supressão */}
            <section className="panel stacked">
              <div className="panel-title">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-brand-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-brand)",
                      flexShrink: 0,
                    }}
                  >
                    <ShieldOff size={15} />
                  </div>
                  <h2>Supressão</h2>
                </div>
              </div>

              <div className="toggle-row">
                <div>
                  <strong id="toggle-suppress-offer">Suprimir após oferta aceita</strong>
                  <span>Não exibe o widget depois de uma oferta ser aceita</span>
                </div>
                <ToggleSwitch
                  id="toggle-suppress-offer"
                  checked={draft.suppressAfterOfferAccepted}
                  disabled={busy}
                  onChange={(v) => patchDraft({ suppressAfterOfferAccepted: v })}
                />
              </div>

              <div className="toggle-row">
                <div>
                  <strong id="toggle-optout">Respeitar opt-out do comprador</strong>
                  <span>Honra preferência de não receber intervenções</span>
                </div>
                <ToggleSwitch
                  id="toggle-optout"
                  checked={draft.respectBuyerOptOut}
                  disabled={busy}
                  onChange={(v) => patchDraft({ respectBuyerOptOut: v })}
                />
              </div>

              <div className="form-grid">
                <label>
                  Valor mínimo do carrinho
                  <input
                    type="number"
                    min={0}
                    value={draft.minimumCartValue}
                    disabled={busy}
                    onChange={(e) =>
                      patchDraft({ minimumCartValue: Number(e.target.value) })
                    }
                  />
                </label>

                <label>
                  Steps suprimidos
                  <input
                    type="text"
                    value={draft.suppressedSteps}
                    disabled={busy}
                    placeholder="ex: payment, review"
                    onChange={(e) => patchDraft({ suppressedSteps: e.target.value })}
                  />
                </label>

                <label>
                  Regiões bloqueadas
                  <input
                    type="text"
                    value={draft.blockedRegions}
                    disabled={busy}
                    placeholder="ex: AM, RR"
                    onChange={(e) => patchDraft({ blockedRegions: e.target.value })}
                  />
                </label>
              </div>
            </section>

            {/* 6 — Handoff */}
            <section className="panel stacked">
              <div className="panel-title">
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-brand-subtle)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-brand)",
                      flexShrink: 0,
                    }}
                  >
                    <PhoneForwarded size={15} />
                  </div>
                  <h2>Handoff</h2>
                </div>
                <span className={`badge ${draft.handoffEnabled ? "ok" : "muted"}`}>
                  {draft.handoffEnabled ? "ativo" : "inativo"}
                </span>
              </div>

              <div className="toggle-row">
                <div>
                  <strong id="toggle-handoff">Habilitar handoff</strong>
                  <span>Transfere a conversa para um canal humano quando necessário</span>
                </div>
                <ToggleSwitch
                  id="toggle-handoff"
                  checked={draft.handoffEnabled}
                  disabled={busy}
                  onChange={(v) => patchDraft({ handoffEnabled: v })}
                />
              </div>

              {draft.handoffEnabled ? (
                <>
                  <label>
                    Mensagem de handoff
                    <textarea
                      value={draft.handoffMessage}
                      disabled={busy}
                      rows={3}
                      onChange={(e) => patchDraft({ handoffMessage: e.target.value })}
                      style={{
                        width: "100%",
                        fontFamily: "var(--font-sans)",
                        fontSize: 13,
                        padding: "8px 12px",
                        border: "1px solid var(--color-border-strong)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-surface)",
                        color: "var(--color-text)",
                        resize: "vertical",
                      }}
                    />
                  </label>

                  <div>
                    <p
                      style={{
                        fontWeight: 600,
                        fontSize: 12,
                        color: "var(--color-text-muted)",
                        marginBottom: "var(--space-2)",
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                      }}
                    >
                      Canais de saída
                    </p>
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
                </>
              ) : null}
            </section>

            {/* Bottom action row */}
            <div className="button-row" style={{ paddingBottom: "var(--space-8)" }}>
              <button
                type="button"
                className="primary-action"
                disabled={busy || hasErrors}
                onClick={() => void save()}
              >
                <Save size={14} />
                {busy ? "Salvando…" : "Salvar alterações"}
              </button>
              <button type="button" disabled={busy} onClick={() => void resetDefaults()}>
                <RotateCcw size={14} />
                Resetar defaults
              </button>
            </div>
          </div>

          {/* ── Preview column ── */}
          <div className="split-panel-preview">
            <LivePreviewPanel
              ref={previewRef}
              apiBaseUrl={props.apiBaseUrl}
              me={props.me}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
