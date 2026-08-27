"use client";

import type { BuyerPurchase, TrackingEvent } from "@/lib/viewmodels/useBuyerHub";

export interface TrackingTabProps {
  purchases: BuyerPurchase[];
}

// ─── Status label map ──────────────────────────────────────────────────────

const TRACKING_STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando rastreio",
  label_generated: "Etiqueta gerada",
  dispatched: "Despachado",
  in_transit: "Em transporte",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  returned: "Devolvido",
  cancelled: "Cancelado",
};

function trackingStatusLabel(status?: string | null): string {
  if (!status) return "Pendente";
  return TRACKING_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

function correiosTrackingUrl(code: string): string {
  return `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(code)}`;
}

// ─── Timeline dot icon ────────────────────────────────────────────────────

function TimelineDot() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        flexShrink: 0,
        color: "var(--aacp-accent)",
      }}
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="4" fill="currentColor" />
    </svg>
  );
}

// ─── Timeline line (between events) ────────────────────────────────────

function TimelineLine() {
  return (
    <div
      style={{
        width: "1px",
        height: "16px",
        background: "var(--aacp-line)",
        margin: "0 5.5px",
      }}
      aria-hidden="true"
    />
  );
}

// ─── Tracking event item ──────────────────────────────────────────────────

function TrackingEventItem({
  event,
  isLast,
}: {
  event: TrackingEvent;
  isLast: boolean;
}) {
  const status = trackingStatusLabel(event.status);
  const date = fmtDate(event.occurred_at);
  const location = event.location || "";
  const description = event.description || "";

  return (
    <div style={{ display: "flex", gap: "8px" }}>
      {/* Timeline track */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <TimelineDot />
        {!isLast && <TimelineLine />}
      </div>

      {/* Event content */}
      <div style={{ flex: 1, paddingBottom: isLast ? "0" : "8px" }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--aacp-fg)" }}>
          {status}
        </div>
        <div style={{ fontSize: "11px", color: "var(--aacp-muted)", marginTop: "2px" }}>
          {date}
          {location && ` • ${location}`}
        </div>
        {description && (
          <div style={{ fontSize: "11px", color: "var(--aacp-muted)", marginTop: "4px", lineHeight: 1.4 }}>
            {description}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function TrackingTab({ purchases }: TrackingTabProps) {
  // Filter: tracking_code exists + tracking_status not in ["delivered", "cancelled"]
  const active = purchases.filter(
    (p) =>
      Boolean(p.tracking_code) &&
      p.tracking_status &&
      p.tracking_status !== "delivered" &&
      p.tracking_status !== "cancelled"
  );

  // Empty state
  if (active.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "48px 16px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: "32px",
            color: "var(--aacp-muted)",
          }}
        >
          📭
        </div>
        <div style={{ fontSize: "13px", color: "var(--aacp-muted)" }}>
          Nenhuma entrega em andamento.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {active.map((purchase) => (
        <TrackingCard key={purchase.id} purchase={purchase} />
      ))}
    </div>
  );
}

// ─── Card component (merchant + tracking code + events) ────────────────────

function TrackingCard({ purchase }: { purchase: BuyerPurchase }) {
  const events = purchase.tracking_events || [];
  const status = trackingStatusLabel(purchase.tracking_status);
  const carrier = purchase.carrier || "Correios";

  return (
    <div
      style={{
        padding: "14px",
        borderRadius: "10px",
        border: "1px solid var(--aacp-line)",
        background: "var(--aacp-surface-2)",
      }}
      role="region"
      aria-label={`Rastreamento - ${purchase.merchant_name}`}
    >
      {/* Header: merchant + carrier badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--aacp-fg)",
          }}
        >
          {purchase.merchant_name}
        </div>
        <div
          style={{
            fontSize: "10px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}
        >
          {carrier}
        </div>
      </div>

      {/* Tracking code + status badge */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: "10px",
          borderBottom: "1px solid var(--aacp-line)",
          marginBottom: "10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11px",
            color: "var(--aacp-muted)",
          }}
        >
          <span style={{ fontWeight: 600 }}>📍</span>
          <span>{purchase.tracking_code}</span>
        </div>
        <div
          style={{
            padding: "3px 8px",
            borderRadius: "4px",
            background: "color-mix(in srgb, var(--aacp-accent) 12%, transparent)",
            color: "var(--aacp-accent)",
            fontSize: "10px",
            fontWeight: 600,
          }}
        >
          {status}
        </div>
      </div>

      {/* Timeline of events */}
      {events.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            marginBottom: "10px",
          }}
        >
          {events.map((event, idx) => (
            <TrackingEventItem
              key={idx}
              event={event}
              isLast={idx === events.length - 1}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            fontSize: "11px",
            color: "var(--aacp-muted)",
            marginBottom: "10px",
            fontStyle: "italic",
          }}
        >
          Rastreamento não disponível ainda.
        </div>
      )}

      {/* Link to Correios */}
      <a
        href={correiosTrackingUrl(purchase.tracking_code!)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          fontSize: "11px",
          color: "var(--aacp-accent)",
          textDecoration: "none",
          fontWeight: 600,
          transition: "opacity 0.15s ease",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.opacity = "0.8";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
        }}
        aria-label={`Rastrear ${purchase.tracking_code} nos Correios`}
      >
        <span>Rastrear nos Correios</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M3 9L9 3M9 3H5M9 3V7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
    </div>
  );
}
