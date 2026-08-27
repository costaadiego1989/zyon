"use client";

import { FiTruck, FiCheckCircle, FiMapPin, FiExternalLink } from "react-icons/fi";
import type { BuyerPurchase, TrackingEvent } from "@/lib/viewmodels/useBuyerHub";

export interface TrackingTabProps {
  purchases: BuyerPurchase[];
}

// ─── Status label map ──────────────────────────────────────────────────────

const TRACKING_STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando envio",
  created: "Criado",
  label_generated: "Etiqueta gerada",
  dispatched: "Despachado",
  in_transit: "Em transporte",
  out_for_delivery: "Saiu para entrega",
  delivered: "Entregue",
  returned: "Devolvido",
  cancelled: "Cancelado",
  "flat-rate": "Frete fixo",
  flat_rate: "Frete fixo",
  free_shipping: "Entrega grátis",
};

// Human-friendly carrier names (the API stores raw keys like "flat-rate").
const CARRIER_LABELS: Record<string, string> = {
  "flat-rate": "Frete fixo",
  flat_rate: "Frete fixo",
  free_shipping: "Entrega grátis",
  "melhor-envio": "Melhor Envio",
  melhor_envio: "Melhor Envio",
  correios: "Correios",
};

function trackingStatusLabel(status?: string | null): string {
  if (!status) return "Aguardando envio";
  const key = status.toLowerCase();
  return TRACKING_STATUS_LABEL[key] ?? status.replace(/_/g, " ");
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function correiosTrackingUrl(code: string): string {
  return `https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(code)}`;
}

// A real tracking code — not an internal reference like "pending:<uuid>" or a bare UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BR_CODE_RE = /^[A-Z]{2}\d{9}[A-Z]{2}$/i;

function isRealTrackingCode(code?: string | null): boolean {
  if (!code) return false;
  const c = code.trim();
  if (!c) return false;
  if (/^pending:/i.test(c)) return false;
  if (UUID_RE.test(c)) return false;
  return true;
}

// Carriers that don't provide a trackable code — direct delivery / flat rate.
function isDirectDelivery(carrier?: string | null): boolean {
  const c = (carrier ?? "").toLowerCase();
  return c.includes("flat") || c.includes("free") || c.includes("grátis") || c.includes("gratis");
}

// Resolve the best tracking URL + link label for a purchase.
// Returns null when no reliable external tracking link exists.
function resolveTracking(
  code: string,
  carrier?: string | null,
  trackingUrl?: string | null,
): { url: string; label: string } | null {
  const carrierLc = (carrier ?? "").toLowerCase();
  const urlLc = (trackingUrl ?? "").toLowerCase();

  // MelhorEnvio: use the provided tracking URL directly.
  if (carrierLc.includes("melhor") || urlLc.includes("melhorenvio")) {
    if (trackingUrl) {
      const href = trackingUrl.startsWith("http") ? trackingUrl : `https://${trackingUrl}`;
      return { url: href, label: "Rastrear no Melhor Envio" };
    }
    return null;
  }

  // Explicit http tracking URL from the carrier.
  if (trackingUrl && trackingUrl.startsWith("http")) {
    return { url: trackingUrl, label: "Rastrear" };
  }

  // Correios: only when carrier is correios or code matches the BR format.
  if (carrierLc.includes("correios") || BR_CODE_RE.test(code)) {
    return { url: correiosTrackingUrl(code), label: "Rastrear nos Correios" };
  }

  return null;
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
  // Group all non-cancelled orders by tracking status
  const allNonCancelled = purchases.filter(
    (p) => p.tracking_status !== "cancelled" && p.tracking_status !== "cancelado",
  );

  const active = allNonCancelled.filter((p) => p.tracking_status !== "delivered" && p.tracking_status !== "entregue");
  const delivered = allNonCancelled.filter((p) => p.tracking_status === "delivered" || p.tracking_status === "entregue");

  // Empty state
  if (allNonCancelled.length === 0) {
    return (
      <div
        role="status"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "48px 16px",
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            background: "var(--aacp-surface-3)",
            color: "var(--aacp-muted)",
          }}
        >
          <FiTruck size={26} />
        </div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--aacp-fg)" }}>
          Nenhuma entrega
        </div>
        <div style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>
          Quando você fizer um pedido com envio, ele aparecerá aqui.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Active tracking section */}
      {active.length > 0 && (
        <fieldset
          style={{
            border: "none",
            padding: 0,
            margin: 0,
          }}
        >
          <legend
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--aacp-muted)",
              marginBottom: "10px",
            }}
          >
            Em andamento
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {active.map((purchase) => (
              <TrackingCard key={purchase.id} purchase={purchase} />
            ))}
          </div>
        </fieldset>
      )}

      {/* Delivered section */}
      {delivered.length > 0 && (
        <fieldset
          style={{
            border: "none",
            padding: 0,
            margin: 0,
          }}
        >
          <legend
            style={{
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--aacp-muted)",
              marginBottom: "10px",
            }}
          >
            Entregues
          </legend>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {delivered.map((purchase) => (
              <TrackingCard key={purchase.id} purchase={purchase} />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

// ─── Card component (merchant + tracking code + events) ────────────────────

function TrackingCard({ purchase }: { purchase: BuyerPurchase }) {
  const events = purchase.tracking_events || [];
  const status = trackingStatusLabel(purchase.tracking_status);
  const carrier = purchase.carrier || "Correios";
  const carrierLabel = CARRIER_LABELS[carrier.toLowerCase()] ?? carrier;
  const rawCode = purchase.tracking_code || "";
  const isDelivered = purchase.tracking_status === "delivered" || purchase.tracking_status === "entregue";
  const isFlatRate = isDirectDelivery(carrier);
  const hasRealCode = isRealTrackingCode(rawCode);
  const tracking = hasRealCode ? resolveTracking(rawCode, carrier, purchase.tracking_url) : null;

  // Delivered state: simple checkmark card
  if (isDelivered) {
    return (
      <div
        style={{
          padding: "14px",
          borderRadius: "10px",
          border: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
        }}
        role="region"
        aria-label={`Rastreamento entregue - ${purchase.merchant_name}`}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            justifyContent: "space-between",
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--aacp-fg)",
              }}
            >
              {purchase.merchant_name}
            </div>
            {hasRealCode && (
              <div style={{ fontSize: "10px", color: "var(--aacp-muted)", marginTop: "4px" }}>
                {rawCode}
              </div>
            )}
          </div>
          <div
            aria-label="Entregue"
            style={{
              flexShrink: 0,
              color: "var(--aacp-success)",
            }}
          >
            <FiCheckCircle size={24} />
          </div>
        </div>
      </div>
    );
  }

  // Flat-rate or free shipping: no tracking code
  if (isFlatRate && !hasRealCode) {
    return (
      <div
        style={{
          padding: "14px",
          borderRadius: "10px",
          border: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
        }}
        role="region"
        aria-label={`Sem rastreio - ${purchase.merchant_name}`}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "8px",
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
            {carrierLabel}
          </div>
        </div>
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "8px",
            background: "color-mix(in srgb, var(--aacp-muted) 8%, transparent)",
            fontSize: "12px",
            color: "var(--aacp-muted)",
            borderLeft: "3px solid var(--aacp-muted)",
          }}
          role="status"
        >
          Sem rastreio — entrega direta
        </div>
      </div>
    );
  }

  // No tracking code yet (pending, UUID, or missing)
  if (!hasRealCode) {
    return (
      <div
        style={{
          padding: "14px",
          borderRadius: "10px",
          border: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
        }}
        role="region"
        aria-label={`Aguardando código - ${purchase.merchant_name}`}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "8px",
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
            {carrierLabel}
          </div>
        </div>
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "8px",
            background: "color-mix(in srgb, var(--aacp-muted) 8%, transparent)",
            fontSize: "12px",
            color: "var(--aacp-muted)",
            borderLeft: "3px solid var(--aacp-muted)",
          }}
          role="status"
        >
          Aguardando código
        </div>
        <div style={{ fontSize: "11px", color: "var(--aacp-muted)", marginTop: "8px" }}>
          Este pedido ainda não possui código de rastreio. Atualize em breve.
        </div>
      </div>
    );
  }

  // Active tracking: timeline + link (only if we have a real tracking URL).
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
          {carrierLabel}
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
          <FiMapPin size={12} aria-hidden="true" />
          <span>{rawCode}</span>
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

      {/* Link to tracking service */}
      {tracking && (
        <a
          href={tracking.url}
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
          aria-label={`${tracking.label} ${rawCode}`}
        >
          <span>{tracking.label}</span>
          <FiExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
