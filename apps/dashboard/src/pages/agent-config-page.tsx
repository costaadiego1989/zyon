import React, { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";
import { QuickRepliesSection } from "../components/quick-replies-section.js";
import type { StageQuickReplies, AgentTone } from "@zyon/shared-types";

const TONE_PT_TO_EN: Record<string, AgentTone> = {
  "Consultivo": "consultative",
  "Premium": "premium",
  "Direto": "direct",
  "Amigável": "friendly",
  "Técnico": "technical"
};

const TONE_EN_TO_PT = Object.fromEntries(Object.entries(TONE_PT_TO_EN).map(([k, v]) => [v, k]));

export interface AgentConfigPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export interface AgentConfigForm {
  agentName: string;
  persona: string;
  tone: AgentTone;
  language: string;
  greeting: string;
  maxDiscountPercent: string;
  minimumMarginPercent: string;
  quickReplies: StageQuickReplies | undefined;
}

const DEFAULT_FORM: AgentConfigForm = {
  agentName: "Assistente",
  persona: "",
  tone: "consultative",
  language: "pt-BR",
  greeting: "Olá! Como posso ajudá-lo?",
  maxDiscountPercent: "10",
  minimumMarginPercent: "15",
  quickReplies: undefined,
};

export function validateAgentConfig(form: AgentConfigForm): Record<string, string> {
  const errors: Record<string, string> = {};

  if (form.agentName.trim().length > 100) {
    errors.agentName = "Máximo 100 caracteres";
  }

  if (form.persona.length > 200) {
    errors.persona = "Máximo 200 caracteres";
  }

  if (form.greeting.length > 500) {
    errors.greeting = "Máximo 500 caracteres";
  }

  const maxDiscount = Number(form.maxDiscountPercent);
  if (Number.isNaN(maxDiscount) || maxDiscount < 0 || maxDiscount > 100) {
    errors.maxDiscountPercent = "Informe um valor entre 0 e 100";
  }

  const minMargin = Number(form.minimumMarginPercent);
  if (Number.isNaN(minMargin) || minMargin < 0 || minMargin > 100) {
    errors.minimumMarginPercent = "Informe um valor entre 0 e 100";
  }

  return errors;
}

export function AgentConfigPage(_props: AgentConfigPageProps) {
  const api = useApi();
  const [form, setForm] = useState<AgentConfigForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const errors = useMemo(() => validateAgentConfig(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (!_props.me) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rules = await api.getMerchantRules();
        const ar = await api.getAgentRules();
        if (cancelled) return;

        const arUnknown = ar as unknown as Record<string, unknown>;
        const rulesUnknown = rules as unknown as Record<string, unknown>;
        const identity = (arUnknown.identity ?? {}) as Record<string, unknown>;

        setForm({
          agentName: String(identity.agentName ?? "Assistente"),
          persona: String(identity.persona ?? ""),
          tone: isValidTone(identity.tone) ? identity.tone : "consultative",
          language: String(identity.language ?? "pt-BR"),
          greeting: String(identity.greeting ?? ""),
          maxDiscountPercent: String(rulesUnknown.maxDiscountPercent ?? 10),
          minimumMarginPercent: String(rulesUnknown.minimumMarginPercent ?? 15),
          quickReplies: (rulesUnknown.quickReplies as unknown as StageQuickReplies | undefined) ?? undefined,
        });
      } catch (e) {
        if (cancelled) return;
        setSaveError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [api, _props.me]);

  function patch(p: Partial<AgentConfigForm>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  async function handleSave() {
    if (hasErrors) {
      setSaveResult("error");
      setSaveError("Corrija os erros antes de salvar");
      return;
    }
    setSaving(true);
    setSaveResult(null);
    setSaveError(null);
    try {
      const rulesPatch: Record<string, unknown> = {
        maxDiscountPercent: Number(form.maxDiscountPercent),
        minimumMarginPercent: Number(form.minimumMarginPercent),
        quickReplies: form.quickReplies,
      };
      await api.putMerchantRules(rulesPatch as never);

      // Send agent rules in proper nested format
      const agentRulesPatch = {
        identity: {
          agentName: form.agentName,
          persona: form.persona,
          tone: form.tone,
          language: form.language,
          greeting: form.greeting,
        }
      };
      await api.putAgentRules(agentRulesPatch as never);

      setSaveResult("success");
    } catch (e) {
      setSaveResult("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!_props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Agente da loja</h1>
          <p className="page-lead">Login necessário.</p>
        </div>
      </header>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Agente da loja</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Personalize o agente que atende seus clientes.</div>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!loaded || saving || hasErrors}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", font: "600 12.5px var(--sans)", color: "white", cursor: !loaded || saving || hasErrors ? "not-allowed" : "pointer", opacity: !loaded || saving || hasErrors ? 0.6 : 1, flex: "none" }}
        >
          <Save size={14} /> {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      <SaveFeedbackBanner
        result={saveResult}
        errorMessage={saveError ?? undefined}
        onDismiss={() => { setSaveResult(null); setSaveError(null); }}
      />

      {loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando configuração do agente...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>IDENTIDADE DO AGENTE</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Nome do Agente</span>
                <input
                  value={form.agentName}
                  onChange={(e) => patch({ agentName: e.target.value })}
                  placeholder="Assistente"
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${errors.agentName ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
                />
                {errors.agentName && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.agentName}</span>}
              </label>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Idioma</span>
                <select
                  value={form.language}
                  onChange={(e) => patch({ language: e.target.value })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
                >
                  <option value="pt-BR">Português (BR)</option>
                  <option value="en-US">English (US)</option>
                  <option value="es-ES">Español</option>
                </select>
              </label>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Tom de Voz</span>
                <select
                  value={form.tone}
                  onChange={(e) => patch({ tone: e.target.value as AgentTone })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
                >
                  {Object.entries(TONE_PT_TO_EN).map(([label, value]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Persona</span>
                <input
                  value={form.persona}
                  onChange={(e) => patch({ persona: e.target.value })}
                  placeholder="Descreva a personalidade do agente"
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${errors.persona ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
                />
                {errors.persona && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.persona}</span>}
              </label>
            </div>
            <div style={{ marginTop: 12 }}>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Saudação Inicial</span>
                <input
                  value={form.greeting}
                  onChange={(e) => patch({ greeting: e.target.value })}
                  placeholder="Olá! Como posso ajudá-lo?"
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${errors.greeting ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
                />
                {errors.greeting && <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.greeting}</span>}
              </label>
            </div>
          </section>

          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>LIMITES DE NEGOCIAÇÃO</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <NumberField
                label="Desconto máximo (%)"
                value={form.maxDiscountPercent}
                onChange={(v) => patch({ maxDiscountPercent: v })}
                error={errors.maxDiscountPercent}
              />
              <NumberField
                label="Margem mínima (%)"
                value={form.minimumMarginPercent}
                onChange={(v) => patch({ minimumMarginPercent: v })}
                error={errors.minimumMarginPercent}
              />
            </div>
          </section>

          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>FAQ / BASE DE CONHECIMENTO</h3>
            <p style={{ font: "12.5px var(--sans)", color: "var(--muted)", margin: 0 }}>
              Gerencie FAQ em <a href="/support/settings" style={{ color: "var(--accent-dark)" }}>Configurações de Suporte</a>.
            </p>
          </section>

          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>QUICK REPLIES</h3>
            <QuickRepliesSection
              value={form.quickReplies}
              onChange={(qr) => patch({ quickReplies: qr })}
            />
          </section>
        </div>
      )}
    </div>
  );
}

function NumberField(props: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <label>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${props.error ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--mono)" }}
      />
      {props.error ? (
        <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{props.error}</span>
      ) : null}
    </label>
  );
}

const VALID_TONES: AgentTone[] = ["consultative", "premium", "direct", "friendly", "technical"];

function isValidTone(value: unknown): value is AgentTone {
  return typeof value === "string" && VALID_TONES.includes(value as AgentTone);
}