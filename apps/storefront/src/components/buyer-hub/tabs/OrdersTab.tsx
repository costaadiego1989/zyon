"use client";

import { useState } from "react";
import type { BuyerPurchase } from "@/lib/viewmodels/useBuyerHub";

// ─── Shared Types ──────────────────────────────────────────────────────────

export interface OrdersTabProps {
  purchases: BuyerPurchase[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

// ─── Formatters ────────────────────────────────────────────────────────────

const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

function fmtBRL(value: number): string {
  if (!Number.isFinite(value)) return brlFmt.format(0);
  return brlFmt.format(value);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFmt.format(d);
}

function trackingStatusLabel(status: string | null | undefined): string {
  if (!status) return "Sem status";
  const s = status.toLowerCase();
  if (s === "delivered" || s === "entregue") return "Entregue";
  if (s === "in_transit" || s === "em_transito" || s === "in transit") return "Em trânsito";
  if (s === "shipped" || s === "enviado" || s === "posted") return "Enviado";
  if (s === "pending" || s === "pendente") return "Pendente";
  if (s === "processing" || s === "em_processamento") return "Em processamento";
  if (s === "cancelled" || s === "cancelado") return "Cancelado";
  if (s === "returned" || s === "devolvido") return "Devolvido";
  if (s === "out_for_delivery" || s === "saiu_para_entrega") return "Saiu para entrega";
  if (s === "failed_attempt" || s === "tentativa_falhou") return "Tentativa falhou";
  return status;
}

function trackingPillTone(status: string | null | undefined): { bg: string; fg: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "delivered" || s === "entregue") {
    return { bg: "color-mix(in oklab, var(--aacp-success) 18%, transparent)", fg: "var(--aacp-success)" };
  }
  if (s === "cancelled" || s === "cancelado" || s === "returned" || s === "devolvido" || s === "failed_attempt") {
    return { bg: "color-mix(in oklab, #d33 14%, transparent)", fg: "#d33" };
  }
  if (!s) {
    return { bg: "var(--aacp-surface-3)", fg: "var(--aacp-muted)" };
  }
  return { bg: "color-mix(in oklab, var(--aacp-accent) 16%, transparent)", fg: "var(--aacp-accent)" };
}

// ─── Inline SVG Icons ──────────────────────────────────────────────────────

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 160ms ease",
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ animation: "aacp-spin 800ms linear infinite" }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ─── Purchase Card ─────────────────────────────────────────────────────────

interface PurchaseCardProps {
  purchase: BuyerPurchase;
  expanded: boolean;
  onToggle: () => void;
}

function PurchaseCard({ purchase, expanded, onToggle }: PurchaseCardProps) {
  const itemsCountLabel =
    purchase.items_count === 1 ? "1 item" : `${purchase.items_count} itens`;
  const tone = trackingPillTone(purchase.tracking_status);
  const statusLabel = trackingStatusLabel(purchase.tracking_status);
  const hasDiscount = (purchase.discount_amount ?? 0) > 0;
  const cardId = `aacp-order-${purchase.id}`;
  const itemsId = `${cardId}-items`;

  return (
    <article
      style={{
        background: "var(--aacp-card)",
        border: "1px solid var(--aacp-line)",
        borderRadius: "12px",
        padding: "12px 14px",
        color: "var(--aacp-fg)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={itemsId}
        aria-label={
          expanded
            ? `Recolher pedido de ${purchase.merchant_name}`
            : `Expandir pedido de ${purchase.merchant_name}`
        }
        style={{
          all: "unset",
          display: "flex",
          width: "100%",
          alignItems: "center",
          gap: "10px",
          cursor: "pointer",
          boxSizing: "border-box",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: "10px",
            }}
          >
            <span
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--aacp-fg)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {purchase.merchant_name}
            </span>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--aacp-fg)",
                whiteSpace: "nowrap",
              }}
            >
              {fmtBRL(purchase.total)}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "4px",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>{itemsCountLabel}</span>
            <span style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>·</span>
            <span style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>
              {fmtDate(purchase.created_at)}
            </span>
            <span
              role="status"
              aria-label={`Status de rastreamento: ${statusLabel}`}
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: "999px",
                background: tone.bg,
                color: tone.fg,
                whiteSpace: "nowrap",
              }}
            >
              {statusLabel}
            </span>
          </div>
        </div>
        <ChevronDownIcon open={expanded} />
      </button>

      {expanded && (
        <div
          id={itemsId}
          role="region"
          aria-label={`Itens do pedido de ${purchase.merchant_name}`}
          style={{
            marginTop: "12px",
            paddingTop: "12px",
            borderTop: "1px dashed var(--aacp-line)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {purchase.items.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>
              Itens indisponíveis para este pedido.
            </div>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {purchase.items.map((item, idx) => {
                const lineTotal = (item.unit_price ?? 0) * (item.quantity ?? 0);
                return (
                  <li
                    key={`${purchase.id}-item-${idx}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: "10px",
                      fontSize: "12px",
                      color: "var(--aacp-fg)",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span style={{ color: "var(--aacp-fg)" }}>{item.name}</span>
                      <span style={{ color: "var(--aacp-muted)" }}>
                        {" "}
                        × {item.quantity}
                      </span>
                    </span>
                    <span style={{ color: "var(--aacp-muted)", whiteSpace: "nowrap" }}>
                      {fmtBRL(item.unit_price)}
                    </span>
                    <span
                      style={{
                        color: "var(--aacp-fg)",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        minWidth: "72px",
                        textAlign: "right",
                      }}
                    >
                      {fmtBRL(lineTotal)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {hasDiscount && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: "12px",
                color: "var(--aacp-success)",
                fontWeight: 600,
                marginTop: "4px",
              }}
            >
              <span>Desconto</span>
              <span>-{fmtBRL(purchase.discount_amount ?? 0)}</span>
            </div>
          )}

          {purchase.tracking_code && (
            <div
              style={{
                marginTop: "4px",
                fontSize: "11px",
                color: "var(--aacp-muted)",
                display: "flex",
                flexWrap: "wrap",
                gap: "6px",
              }}
            >
              <span>Rastreio:</span>
              <span style={{ color: "var(--aacp-fg)", fontWeight: 600 }}>{purchase.tracking_code}</span>
              {purchase.carrier && <span>· {purchase.carrier}</span>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function OrdersTab({ purchases, hasMore, loadingMore, onLoadMore }: OrdersTabProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (purchases.length === 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "36px 16px",
          color: "var(--aacp-muted)",
          textAlign: "center",
        }}
      >
        <span style={{ color: "var(--aacp-muted)" }}>
          <PackageIcon />
        </span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>
          Nenhum pedido ainda.
        </span>
        <span style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>
          Suas compras aparecerão aqui assim que forem concluídas.
        </span>
      </div>
    );
  }

  return (
    <section aria-label="Lista de pedidos" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <ul
        role="list"
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {purchases.map((purchase) => (
          <li key={purchase.id}>
            <PurchaseCard
              purchase={purchase}
              expanded={expandedIds.has(purchase.id)}
              onToggle={() => toggle(purchase.id)}
            />
          </li>
        ))}
      </ul>

      {hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "6px" }}>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            aria-label="Carregar mais pedidos"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              borderRadius: "10px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface-2)",
              color: "var(--aacp-fg)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: loadingMore ? "wait" : "pointer",
              opacity: loadingMore ? 0.7 : 1,
              transition: "background 120ms ease",
            }}
          >
            {loadingMore && <SpinnerIcon />}
            <span>{loadingMore ? "Carregando…" : "Carregar mais"}</span>
          </button>
        </div>
      )}
    </section>
  );
}

export default OrdersTab;
