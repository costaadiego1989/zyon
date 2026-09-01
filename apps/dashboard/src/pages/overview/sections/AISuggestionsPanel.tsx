import React, { useCallback, useEffect, useState } from "react";
import { Sparkles, TrendingUp, Check, FlaskConical, X } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { MerchantProfile } from "../../../api-client.js";
import type {
  Hypothesis,
  HypothesisDiscountRule,
  HypothesisRuleCondition,
  ApproveMode,
} from "../../../api/endpoints/revenue-manager.js";

export type AISuggestionsPanelProps = {
  me: MerchantProfile;
};

const FIELD_LABELS: Record<string, string> = {
  cart_total: "Valor do carrinho",
  cart_item_count: "Itens no carrinho",
  buyer_type: "Tipo de comprador",
  category_in_cart: "Categoria no carrinho",
  coupon_applied: "Cupom aplicado",
};

const OPERATOR_LABELS: Record<string, string> = {
  gte: "≥",
  gt: ">",
  lte: "≤",
  lt: "<",
  eq: "=",
  is: "=",
  contains: "contém",
  in: "em",
};

function formatCondition(c: HypothesisRuleCondition): string {
  const field = FIELD_LABELS[c.field] ?? c.field;
  const op = OPERATOR_LABELS[c.operator] ?? c.operator;
  return `${field} ${op} ${String(c.value)}`;
}

function formatAction(rule: HypothesisDiscountRule): string {
  const { type, params } = rule.action;
  if (type === "offer_free_shipping") return "Oferecer frete grátis";
  if (type === "offer_discount") {
    const percent = params.percent;
    const cap = params.maxDiscountReais;
    const pct = percent != null ? `${percent}%` : "desconto";
    return cap != null ? `Oferecer ${pct} (cap R$${cap})` : `Oferecer ${pct}`;
  }
  return `${type}`;
}

function RuleSummary({ rule }: { rule: HypothesisDiscountRule }) {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)" }}>SE</span>
        {rule.conditions.map((c, i) => (
          <span
            key={i}
            style={{
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              background: "var(--color-brand-subtle)",
              color: "var(--color-brand)",
              padding: "2px 8px",
              borderRadius: 6,
            }}
          >
            {formatCondition(c)}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)" }}>ENTÃO</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-success)",
          }}
        >
          {formatAction(rule)}
        </span>
      </div>
    </div>
  );
}

function SuggestionCard({
  h,
  busy,
  onApprove,
  onReject,
}: {
  h: Hypothesis;
  busy: boolean;
  onApprove: (mode: ApproveMode) => void;
  onReject: () => void;
}) {
  const rule = h.template?.discount_rule_json;
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", lineHeight: 1.35 }}>
            {h.hypothesis_text}
          </div>
          {h.reasoning ? (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.45 }}>
              {h.reasoning}
            </p>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            background: "var(--color-success-bg, var(--color-brand-subtle))",
            color: "var(--color-success)",
            padding: "4px 10px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
          title="Ganho estimado de conversão"
        >
          <TrendingUp size={13} />
          +{h.expected_lift_percent}%
        </div>
      </div>

      {rule ? <RuleSummary rule={rule} /> : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="zyn-btn zyn-btn--primary"
          style={{ fontSize: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
          disabled={busy}
          onClick={() => onApprove("apply_direct")}
        >
          <Check size={14} /> Aprovar (aplicar direto)
        </button>
        <button
          type="button"
          className="zyn-btn zyn-btn--secondary"
          style={{ fontSize: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
          disabled={busy}
          onClick={() => onApprove("test_ab")}
        >
          <FlaskConical size={14} /> Testar A/B
        </button>
        <button
          type="button"
          className="zyn-btn zyn-btn--ghost"
          style={{ fontSize: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}
          disabled={busy}
          onClick={onReject}
        >
          <X size={14} /> Rejeitar
        </button>
      </div>
    </div>
  );
}

export function AISuggestionsPanel({ me }: AISuggestionsPanelProps) {
  const api = useApi();
  const [items, setItems] = useState<Hypothesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getHypotheses?.({ status: "pending_review" });
      setItems(data ?? []);
    } catch (e) {
      reportError({ source: "overview.ai-suggestions.load", error: e });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeCard = (id: string) => setItems((prev) => prev.filter((h) => h.id !== id));

  const markBusy = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const approve = async (id: string, mode: ApproveMode) => {
    markBusy(id, true);
    try {
      await api.approveHypothesis?.(id, { approved_by: me.id, mode });
      showToast(
        "success",
        mode === "apply_direct"
          ? "Sugestão aprovada — regra aplicada imediatamente"
          : "Sugestão aprovada — teste A/B iniciado",
      );
      removeCard(id);
    } catch (e) {
      reportError({ source: "overview.ai-suggestions.approve", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao aprovar sugestão");
    } finally {
      markBusy(id, false);
    }
  };

  const reject = async (id: string) => {
    markBusy(id, true);
    try {
      await api.rejectHypothesis?.(id, { reason: "Rejeitada pelo lojista" });
      showToast("success", "Sugestão rejeitada");
      removeCard(id);
    } catch (e) {
      reportError({ source: "overview.ai-suggestions.reject", error: e });
      showToast("error", e instanceof Error ? e.message : "Erro ao rejeitar sugestão");
    } finally {
      markBusy(id, false);
    }
  };

  // Only render when there are pending suggestions (hide while loading / when empty).
  if (loading || items.length === 0) return null;

  return (
    <section
      className="panel"
      style={{ display: "flex", flexDirection: "column", gap: 14, borderColor: "var(--color-brand)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius-sm)",
            background: "var(--color-brand-subtle)",
            color: "var(--color-brand)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Sparkles size={18} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--color-brand)", letterSpacing: -0.3 }}>
            Sugestões de IA
          </h3>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--color-text-secondary)" }}>
            {items.length} {items.length === 1 ? "otimização proposta" : "otimizações propostas"} para revisão
          </p>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((h) => (
          <SuggestionCard
            key={h.id}
            h={h}
            busy={busy.has(h.id)}
            onApprove={(mode) => void approve(h.id, mode)}
            onReject={() => void reject(h.id)}
          />
        ))}
      </div>
    </section>
  );
}
