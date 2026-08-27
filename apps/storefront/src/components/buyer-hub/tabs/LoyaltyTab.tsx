"use client";

import type { BuyerLoyalty, BuyerSummary } from "@/lib/viewmodels/useBuyerHub";

// ─── Shared Types ──────────────────────────────────────────────────────────

export interface LoyaltyTabProps {
  loyalty: BuyerLoyalty | null;
  summary: BuyerSummary | null;
  loading: boolean;
}

// ─── Formatters ────────────────────────────────────────────────────────────

const currencyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function fmtBRL(value: number | null | undefined): string {
  return currencyFmt.format(Number.isFinite(value as number) ? (value as number) : 0);
}

// ─── Icons (inline SVG) ────────────────────────────────────────────────────

function IconShoppingBag() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}

function IconDollarSign() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  );
}

function IconTrendingUp() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function IconTag() {
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
      focusable="false"
    >
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function IconHeart() {
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
      focusable="false"
    >
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}

function IconPercent() {
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
      focusable="false"
    >
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

function KpiCard({ icon, label, value }: KpiCardProps) {
  return (
    <div
      style={{
        flex: "1 1 0%",
        minWidth: "100px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "14px",
        borderRadius: "10px",
        background: "var(--aacp-card)",
        border: "1px solid var(--aacp-line)",
      }}
      role="group"
      aria-label={label}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          color: "var(--aacp-muted)",
        }}
      >
        {icon}
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: "18px",
          fontWeight: 700,
          color: "var(--aacp-fg)",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────

function Chip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: "6px",
        background: "color-mix(in srgb, var(--aacp-accent) 12%, transparent)",
        color: "var(--aacp-accent)",
        fontSize: "12px",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ─── Discount Sensitivity Bar ─────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        paddingBottom: "16px",
      }}
      aria-busy="true"
      aria-label="Carregando dados de fidelidade"
    >
      <div style={{ display: "flex", gap: "10px" }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: "1 1 0%",
              height: "80px",
              borderRadius: "10px",
              background: "var(--aacp-surface-2)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
        ))}
      </div>
      <div style={{ height: "60px", borderRadius: "8px", background: "var(--aacp-surface-2)" }} />
      <div style={{ height: "60px", borderRadius: "8px", background: "var(--aacp-surface-2)" }} />
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "48px 24px",
        gap: "16px",
        color: "var(--aacp-muted)",
      }}
      role="status"
      aria-label="Nenhum dado de fidelidade disponível"
    >
      <IconPackage />
      <div>
        <div
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--aacp-fg)",
            marginBottom: "6px",
          }}
        >
          Nenhum dado de fidelidade
        </div>
        <div style={{ fontSize: "12px", color: "var(--aacp-muted)", lineHeight: 1.5, maxWidth: "260px" }}>
          Faça compras para desbloquear seu perfil de fidelidade com categorias favoritas, marcas preferidas e mais.
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function LoyaltyTab({ loyalty, summary, loading }: LoyaltyTabProps) {
  if (loading) return <LoadingSkeleton />;

  if (!loyalty && !summary) return <EmptyState />;

  const num = (v: unknown): number => (Number.isFinite(v as number) ? (v as number) : 0);

  const ordersCount = num(summary?.orders_count) || num(loyalty?.total_orders) || 0;
  const totalSpent =
    Number.isFinite(summary?.total_spent as number)
      ? num(summary?.total_spent)
      : num(loyalty?.total_spent_cents) / 100;
  const averageTicket =
    Number.isFinite(summary?.average_ticket as number)
      ? num(summary?.average_ticket)
      : num(loyalty?.avg_order_value_cents) / 100;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        paddingBottom: "16px",
      }}
    >
      {/* KPI Cards */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
        }}
        role="group"
        aria-label="Indicadores de fidelidade"
      >
        <KpiCard
          icon={<IconShoppingBag />}
          label="Pedidos"
          value={String(ordersCount)}
        />
        <KpiCard
          icon={<IconDollarSign />}
          label="Total gasto"
          value={fmtBRL(totalSpent)}
        />
        <KpiCard
          icon={<IconTrendingUp />}
          label="Ticket médio"
          value={fmtBRL(averageTicket)}
        />
      </div>

      {/* Categorias favoritas */}
      {loyalty?.top_categories && loyalty.top_categories.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "10px",
              color: "var(--aacp-muted)",
            }}
          >
            <IconTag />
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Categorias favoritas
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
            role="list"
            aria-label="Categorias favoritas"
          >
            {loyalty.top_categories.map((cat) => (
              <div key={cat} role="listitem">
                <Chip label={cat} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Marcas preferidas */}
      {loyalty?.preferred_brands && loyalty.preferred_brands.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "10px",
              color: "var(--aacp-muted)",
            }}
          >
            <IconHeart />
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Marcas preferidas
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
            }}
            role="list"
            aria-label="Marcas preferidas"
          >
            {loyalty.preferred_brands.map((brand) => (
              <div key={brand} role="listitem">
                <Chip label={brand} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Descontos disponíveis */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "10px",
            color: "var(--aacp-muted)",
          }}
        >
          <IconPercent />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Descontos disponíveis
          </span>
        </div>
        <div
          style={{
            padding: "16px 14px",
            borderRadius: "10px",
            border: "2px dashed var(--aacp-line)",
            background: "color-mix(in srgb, var(--aacp-surface-2) 50%, transparent)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
            textAlign: "center",
          }}
        >
          <IconTag />
          <div
            style={{
              fontSize: "12px",
              color: "var(--aacp-muted)",
              lineHeight: 1.5,
              maxWidth: "280px",
            }}
          >
            Nenhum cupom disponível no momento. Ofertas personalizadas aparecerão aqui durante o checkout.
          </div>
        </div>
      </div>
    </div>
  );
}
