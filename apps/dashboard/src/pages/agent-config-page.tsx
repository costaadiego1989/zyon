import React, { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";
import { QuickRepliesSection } from "../components/quick-replies-section.js";
import type { StageQuickReplies } from "@zyon/shared-types";

const PERSONALITIES = ["formal", "casual", "descontraido"] as const;
const TONES = ["prestativo", "profissional", "divertido"] as const;

export interface AgentConfigPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export interface AgentConfigForm {
  personality: (typeof PERSONALITIES)[number];
  tone: (typeof TONES)[number];
  maxDiscountPercent: string;
  minimumMarginPercent: string;
  maxCouponCents: string;
  faqJson: string;
  quickReplies: StageQuickReplies | undefined;
}

const DEFAULT_FORM: AgentConfigForm = {
  personality: "casual",
  tone: "prestativo",
  maxDiscountPercent: "10",
  minimumMarginPercent: "15",
  maxCouponCents: "5000",
  faqJson: "[]",
  quickReplies: undefined,
};

export function validateAgentConfig(form: AgentConfigForm): Record<string, string> {
  const errors: Record<string, string> = {};

  const maxDiscount = Number(form.maxDiscountPercent);
  if (Number.isNaN(maxDiscount) || maxDiscount < 0 || maxDiscount > 100) {
    errors.maxDiscountPercent = "Informe um valor entre 0 e 100";
  }

  const minMargin = Number(form.minimumMarginPercent);
  if (Number.isNaN(minMargin) || minMargin < 0 || minMargin > 100) {
    errors.minimumMarginPercent = "Informe um valor entre 0 e 100";
  }

  const coupon = Number(form.maxCouponCents);
  if (Number.isNaN(coupon) || coupon < 0) {
    errors.maxCouponCents = "Valor inválido";
  }

  if (form.faqJson.trim()) {
    try {
      const parsed = JSON.parse(form.faqJson);
      if (!Array.isArray(parsed)) errors.faqJson = "FAQ deve ser uma lista";
    } catch (e) {
      errors.faqJson = `JSON inválido: ${e instanceof Error ? e.message : String(e)}`;
    }
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
        const personalityRaw = arUnknown.personality;
        const toneRaw = arUnknown.tone;
        const faqRaw = arUnknown.faq;

        setForm({
          personality: isPersonality(personalityRaw) ? personalityRaw : "casual",
          tone: isTone(toneRaw) ? toneRaw : "prestativo",
          maxDiscountPercent: String(rulesUnknown.maxDiscountPercent ?? 10),
          minimumMarginPercent: String(rulesUnknown.minimumMarginPercent ?? 15),
          maxCouponCents: String(arUnknown.maxCouponCents ?? 5000),
          faqJson: faqRaw ? JSON.stringify(faqRaw, null, 2) : "[]",
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

      const agentRules = await api.getAgentRules();
      const arUnknown = agentRules as unknown as Record<string, unknown>;
      const next = {
        ...arUnknown,
        personality: form.personality,
        tone: form.tone,
        maxCouponCents: Number(form.maxCouponCents),
        faq: form.faqJson.trim() ? JSON.parse(form.faqJson) : [],
      };
      await api.putAgentRules(next as never);

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
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>PERSONALIDADE E TOM</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Personalidade</span>
                <select
                  value={form.personality}
                  onChange={(e) => patch({ personality: e.target.value as AgentConfigForm["personality"] })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
                >
                  {PERSONALITIES.map((p) => (
                    <option key={p} value={p}>{personalityLabel(p)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Tom</span>
                <select
                  value={form.tone}
                  onChange={(e) => patch({ tone: e.target.value as AgentConfigForm["tone"] })}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", font: "12.5px var(--sans)" }}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>{toneLabel(t)}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>LIMITES DE NEGOCIAÇÃO</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
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
              <NumberField
                label="Valor máximo de cupom (centavos)"
                value={form.maxCouponCents}
                onChange={(v) => patch({ maxCouponCents: v })}
                error={errors.maxCouponCents}
              />
            </div>
          </section>

          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>KNOWLEDGE BASE / FAQ</h3>
            <label style={{ display: "block" }}>
              <textarea
                value={form.faqJson}
                onChange={(e) => patch({ faqJson: e.target.value })}
                rows={8}
                placeholder='[{"question": "...", "answer": "..."}]'
                style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: `1px solid ${errors.faqJson ? "var(--danger)" : "var(--border)"}`, background: "var(--bg)", color: "var(--ink)", font: "12px var(--mono)", resize: "vertical" }}
              />
              {errors.faqJson ? (
                <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{errors.faqJson}</span>
              ) : (
                <span style={{ font: "11px var(--sans)", color: "var(--faint)", marginTop: 4, display: "block" }}>
                  JSON opcional. Lista de perguntas frequentes para o agente.
                </span>
              )}
            </label>
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

function personalityLabel(p: (typeof PERSONALITIES)[number]): string {
  return { formal: "Formal", casual: "Casual", descontraido: "Descontraído" }[p];
}

function toneLabel(t: (typeof TONES)[number]): string {
  return { prestativo: "Prestativo", profissional: "Profissional", divertido: "Divertido" }[t];
}

function isPersonality(value: unknown): value is AgentConfigForm["personality"] {
  return typeof value === "string" && (PERSONALITIES as readonly string[]).includes(value);
}

function isTone(value: unknown): value is AgentConfigForm["tone"] {
  return typeof value === "string" && (TONES as readonly string[]).includes(value);
}