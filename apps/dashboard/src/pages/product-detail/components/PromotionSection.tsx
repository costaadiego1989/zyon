import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Percent, DollarSign, Ticket, BadgePercent, Sparkles } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { CouponCombobox } from "./CouponCombobox.js";
import { RulesList } from "../../checkout-settings/components/RulesList.js";
import { RuleEditor } from "../../checkout-settings/components/RuleEditor.js";
import { PrefixInput } from "../../../components/PrefixInput.js";
import { Button } from "../../../components/Button.js";
import { showToast } from "../../../components/Toast.js";
import { useCatalogApi } from "../../../hooks/api/useCatalogApi.js";
import { usePlanFeatures } from "../../../hooks/api/usePlanFeatures.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import { reaisToCents, applyCurrencyMask } from "../../../utils/currency.js";
import type { AdvancedRule } from "../../checkout-settings/lib/draft.js";
import type { CreatePromotionPayload, ProductPromotion } from "../../../api/endpoints/catalog.js";
// RuleEditor + RulesList rely on the checkout-settings stylesheet (cfg-* classes,
// --cfg-* tokens, the slide-in side panel). Import it here so the reused rule
// builder renders styled inside the product form instead of as raw markup.
import "../../checkout-settings/checkout-settings-page.css";

type DiscountMode = "percent" | "fixed" | "promo_price" | "coupon";

const MODES: Array<{ value: DiscountMode; label: string; icon: React.ReactNode }> = [
  { value: "percent", label: "Desconto %", icon: <Percent size={14} /> },
  { value: "fixed", label: "Valor fixo (R$)", icon: <DollarSign size={14} /> },
  { value: "promo_price", label: "Preço promocional", icon: <BadgePercent size={14} /> },
  { value: "coupon", label: "Vincular cupom", icon: <Ticket size={14} /> },
];

/** Build a `datetime-local`-compatible string (YYYY-MM-DDTHH:mm) from a Date, local tz. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  font: "13px var(--font-sans)",
  color: "var(--color-text)",
  outline: "none",
  background: "var(--surface-1)",
};

const labelSpanStyle: React.CSSProperties = {
  font: "600 12px var(--font-sans)",
  color: "var(--color-text)",
  display: "block",
  marginBottom: 4,
};

export interface PromotionSectionProps {
  merchantId: string;
  productId: string | null; // null when in create mode
  variantSkus: string[];
  onPendingPromoChange?: (config: CreatePromotionPayload | null) => void;
  onPendingRulesChange?: (config: { rules: AdvancedRule[]; productSkus: string[] } | null) => void;
}

export function PromotionSection({ merchantId, productId, variantSkus, onPendingPromoChange, onPendingRulesChange }: PromotionSectionProps) {
  const catalog = useCatalogApi();
  const { hasFeature } = usePlanFeatures();
  const isCreateMode = !productId;

  const now = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), []);

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<DiscountMode>("percent");
  const [percent, setPercent] = useState("");
  const [fixedReais, setFixedReais] = useState("");
  const [promoPriceReais, setPromoPriceReais] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState(toLocalInput(defaultEnd));
  const [saving, setSaving] = useState(false);
  const [promo, setPromo] = useState<ProductPromotion | null>(null);

  // Advanced rules (plan-gated)
  const [rules, setRules] = useState<AdvancedRule[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AdvancedRule | null>(null);
  const [savingRules, setSavingRules] = useState(false);

  const buildPromotionPayload = useCallback((): CreatePromotionPayload => {
    const payload: CreatePromotionPayload = {
      isActive: enabled,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
    };
    if (mode === "percent") {
      payload.discountType = "percent";
      payload.discountValue = Math.max(0, Math.min(100, Number(percent) || 0));
    } else if (mode === "fixed") {
      payload.discountType = "fixed";
      payload.discountValue = reaisToCents(fixedReais); // cents
    } else if (mode === "promo_price") {
      payload.promoPriceInCents = reaisToCents(promoPriceReais);
    } else if (mode === "coupon") {
      payload.couponId = couponCode || undefined;
    }
    return payload;
  }, [enabled, startsAt, endsAt, mode, percent, fixedReais, promoPriceReais, couponCode]);

  // Create mode: lift the configured promo up to the parent so it can be
  // created AFTER the product is saved. Only push when the toggle is enabled.
  useEffect(() => {
    if (!isCreateMode || !onPendingPromoChange) return;
    onPendingPromoChange(enabled ? buildPromotionPayload() : null);
  }, [isCreateMode, onPendingPromoChange, enabled, buildPromotionPayload]);

  // Create mode: lift configured advanced rules up to the parent.
  useEffect(() => {
    if (!isCreateMode || !onPendingRulesChange) return;
    onPendingRulesChange(rules.length > 0 ? { rules, productSkus: variantSkus } : null);
  }, [isCreateMode, onPendingRulesChange, rules, variantSkus]);

  async function handleSavePromotion() {
    if (isCreateMode || !productId) return; // create mode defers to parent post-save
    setSaving(true);
    try {
      const payload = buildPromotionPayload();
      const saved = promo?.id
        ? await catalog.updatePromotion(merchantId, productId, promo.id, payload)
        : await catalog.createPromotion(merchantId, productId, payload);
      setPromo(saved);
      showToast("success", promo?.id ? "Promoção atualizada" : "Promoção criada");
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar promoção");
      reportError({ source: "PromotionSection.savePromotion", error: e });
    } finally {
      setSaving(false);
    }
  }

  async function persistRules(next: AdvancedRule[]) {
    // Create mode: don't hit the API (no productId yet). The parent lifts the
    // rules via onPendingRulesChange and persists them after the product saves.
    if (isCreateMode || !productId) return;
    setSavingRules(true);
    try {
      await catalog.upsertProductAdvancedRules(merchantId, productId, {
        rules: next,
        productSkus: variantSkus,
      });
      showToast("success", "Regras avançadas salvas");
    } catch (e) {
      // Endpoint may not be wired yet — tolerate gracefully.
      showToast("error", "Regras avançadas indisponíveis no momento");
      reportError({ source: "PromotionSection.upsertAdvancedRules", error: e });
    } finally {
      setSavingRules(false);
    }
  }

  return (
    <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <ToggleSwitch checked={enabled} disabled={saving} onChange={setEnabled} />
        <div style={{ flex: 1 }}>
          <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>
            Produto com promoção
          </div>
          <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>
            {enabled ? "Desconto, cupom ou regras avançadas ativos neste produto" : "Ative para aplicar desconto, cupom ou regras avançadas"}
          </div>
        </div>
      </label>

      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginTop: 18 }}>
          {/* Discount mode selector (segmented) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                style={{
                  padding: "10px 8px",
                  borderRadius: 8,
                  border: `2px solid ${mode === m.value ? "var(--color-brand-hover)" : "var(--color-border)"}`,
                  background: mode === m.value ? "var(--color-brand-subtle)" : "var(--surface-1)",
                  color: mode === m.value ? "var(--color-brand-hover)" : "var(--color-text)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  font: "600 11px var(--font-sans)",
                  transition: "all 0.15s",
                }}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>

          {/* Discount value + date range — inline row */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
            {mode === "percent" && (
              <div style={{ flex: "0 0 160px" }}>
                <span style={labelSpanStyle}>Desconto (%)</span>
                <PrefixInput
                  prefix="%"
                  inputMode="decimal"
                  value={percent}
                  onChange={(v) => setPercent(v.replace(/[^\d]/g, "").slice(0, 3))}
                  placeholder="10"
                />
              </div>
            )}
            {mode === "fixed" && (
              <div style={{ flex: "0 0 180px" }}>
                <span style={labelSpanStyle}>Valor fixo (R$)</span>
                <PrefixInput
                  prefix="R$"
                  inputMode="decimal"
                  value={fixedReais}
                  onChange={(v) => setFixedReais(applyCurrencyMask(v))}
                  placeholder="0,00"
                />
              </div>
            )}
            {mode === "promo_price" && (
              <div style={{ flex: "0 0 180px" }}>
                <span style={labelSpanStyle}>Preço promocional (R$)</span>
                <PrefixInput
                  prefix="R$"
                  inputMode="decimal"
                  value={promoPriceReais}
                  onChange={(v) => setPromoPriceReais(applyCurrencyMask(v))}
                  placeholder="0,00"
                />
              </div>
            )}
            {mode === "coupon" && (
              <div style={{ flex: "0 0 260px" }}>
                <span style={labelSpanStyle}>Cupom</span>
                <CouponCombobox value={couponCode} onChange={setCouponCode} disabled={saving} />
              </div>
            )}
            <label style={{ display: "block", flex: "0 0 210px" }}>
              <span style={labelSpanStyle}>Início</span>
              <input
                type="datetime-local"
                value={startsAt}
                disabled={saving}
                onChange={(e) => setStartsAt(e.target.value)}
                onFocus={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* not supported */ } }}
                onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* not supported */ } }}
                style={{ ...inputStyle, cursor: "pointer" }}
              />
            </label>
            <label style={{ display: "block", flex: "0 0 210px" }}>
              <span style={labelSpanStyle}>Fim</span>
              <input
                type="datetime-local"
                value={endsAt}
                disabled={saving}
                onChange={(e) => setEndsAt(e.target.value)}
                onFocus={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* not supported */ } }}
                onClick={(e) => { try { (e.currentTarget as any).showPicker?.(); } catch { /* not supported */ } }}
                style={{ ...inputStyle, cursor: "pointer" }}
              />
            </label>
          </div>

          {isCreateMode ? (
            <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", margin: 0 }}>
              A promoção será criada junto com o produto ao clicar em "Criar produto".
            </p>
          ) : (
            <div>
              <Button variant="primary" size="sm" arrow disabled={saving} onClick={() => void handleSavePromotion()}>
                {saving ? "Salvando..." : promo?.id ? "Atualizar promoção" : "Salvar promoção"}
              </Button>
            </div>
          )}

          {/* Advanced rules — plan gated */}
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 16, marginTop: 4 }}>
            <h4 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={13} /> REGRAS AVANÇADAS
            </h4>
            {hasFeature("advancedRules") ? (
              <div className="cfg-page">
                <RulesList
                  rules={rules}
                  busy={savingRules}
                  onAdd={() => {
                    setEditingRule(null);
                    setEditorOpen(true);
                  }}
                  onEdit={(id) => {
                    const r = rules.find((x) => x.id === id);
                    if (r) {
                      setEditingRule(r);
                      setEditorOpen(true);
                    }
                  }}
                  onDelete={(id) => {
                    const next = rules.filter((r) => r.id !== id);
                    setRules(next);
                    void persistRules(next);
                  }}
                  onToggle={(id, ruleEnabled) => {
                    const next = rules.map((r) => (r.id === id ? { ...r, enabled: ruleEnabled } : r));
                    setRules(next);
                    void persistRules(next);
                  }}
                  onReorder={(reordered) => {
                    setRules(reordered);
                    void persistRules(reordered);
                  }}
                />
                {editorOpen && (
                  <RuleEditor
                    rule={editingRule}
                    busy={savingRules}
                    onSave={(rule) => {
                      const exists = rules.some((r) => r.id === rule.id);
                      const next = exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
                      setRules(next);
                      setEditorOpen(false);
                      setEditingRule(null);
                      void persistRules(next);
                    }}
                    onCancel={() => {
                      setEditorOpen(false);
                      setEditingRule(null);
                    }}
                  />
                )}
              </div>
            ) : (
              <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", margin: 0 }}>
                Disponível no plano Growth+.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
