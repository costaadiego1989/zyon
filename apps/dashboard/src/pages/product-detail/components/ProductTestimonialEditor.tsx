"use client";

import React, { useCallback } from "react";
import { Star, XCircle, CheckCircle2 } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { EmptyState } from "../../../components/EmptyState.js";
import type { ProductTestimonial } from "../../../api/endpoints/product-content.js";

/**
 * Read-only display of the testimonials that already belong to this product
 * (real buyer submissions or merchant-imported feedback).
 *
 * The merchant can't add or edit testimonials here — that data lives in the
 * post-sale / reviews pipeline. From this editor the merchant can:
 *
 *  - See every testimonial linked to the product, sorted newest first
 *  - Approve / reject pending entries via `onModerate`
 *  - Toggle whether the testimonials block is rendered on the storefront
 *
 * The toggle is local to the editor; the visibility state is part of the
 * `AdvancedLayoutSurface` toggle (AdvancedLayoutEnableToggle) and does NOT
 * require a separate write — when the merchant flips the section toggle off,
 * the storefront hides every testimonial regardless of `isPublished`.
 */
export interface ProductTestimonialEditorProps {
  testimonials: ProductTestimonial[];
  busy?: boolean;
  onModerate: (
    id: string,
    action: "approved" | "rejected",
    isPublished: boolean,
  ) => Promise<void>;
  /** Toggles whether the testimonials block is rendered on the storefront. */
  showOnStorefront: boolean;
  onToggleShow: (next: boolean) => void;
}

export function ProductTestimonialEditor({
  testimonials,
  busy = false,
  onModerate,
  showOnStorefront,
  onToggleShow,
}: ProductTestimonialEditorProps) {
  const handleModerate = useCallback(
    async (id: string, action: "approved" | "rejected") => {
      try {
        await onModerate(id, action, action === "approved");
      } catch {
        // toast handled by parent
      }
    },
    [onModerate],
  );

  const sorted = [...testimonials].sort((a, b) => {
    // Pending first so the merchant sees what needs attention.
    if (a.moderationStatus === "pending" && b.moderationStatus !== "pending") return -1;
    if (b.moderationStatus === "pending" && a.moderationStatus !== "pending") return 1;
    return 0;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          background: "var(--surface-1)",
          cursor: busy ? "not-allowed" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        <ToggleSwitch
          checked={showOnStorefront}
          disabled={busy}
          onChange={onToggleShow}
        />
        <div style={{ flex: 1 }}>
          <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>
            Exibir depoimentos no card do produto
          </div>
          <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-muted)" }}>
            {showOnStorefront
              ? `${testimonials.length} depoimento${testimonials.length === 1 ? "" : "s"} visíveis na página do produto.`
              : "Desativado por padrão. Compras e avaliações continuam registradas — basta ativar quando quiser exibir."}
          </div>
        </div>
      </label>

      {sorted.length === 0 ? (
        <EmptyState
          title="Sem depoimentos ainda"
          message="Depoimentos são gerados automaticamente após cada pedido avaliado."
        />
      ) : null}

      {sorted.map((t) => (
        <div
          key={t.id}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            background: "var(--surface-2)",
            padding: "10px 12px",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                {t.authorName}
              </strong>
              {t.rating ? (
                <span style={{ color: "var(--color-warning)", display: "inline-flex", gap: 2 }}>
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} size={12} fill="currentColor" />
                  ))}
                </span>
              ) : null}
              <span
                style={{
                  font: "10.5px var(--font-mono)",
                  color: "var(--color-text-faint)",
                  letterSpacing: "0.05em",
                  padding: "2px 6px",
                  background: "var(--surface-1)",
                  borderRadius: 4,
                }}
              >
                {t.moderationStatus.toUpperCase()}
              </span>
            </div>
            <p
              style={{
                margin: "4px 0 0",
                font: "12.5px var(--font-sans)",
                color: "var(--color-text)",
                lineHeight: 1.5,
              }}
            >
              {t.body}
            </p>
            {t.moderationStatus === "pending" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleModerate(t.id, "approved")}
                  style={{
                    font: "600 11px var(--font-mono)",
                    color: "var(--color-success, #16A34A)",
                    background: "transparent",
                    border: "1px solid var(--color-border)",
                    borderRadius: 4,
                    padding: "3px 8px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <CheckCircle2 size={11} /> Aprovar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleModerate(t.id, "rejected")}
                  style={{
                    font: "600 11px var(--font-mono)",
                    color: "var(--color-danger, #b91c1c)",
                    background: "transparent",
                    border: "1px solid var(--color-border)",
                    borderRadius: 4,
                    padding: "3px 8px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <XCircle size={11} /> Rejeitar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
