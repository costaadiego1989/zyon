import React from "react";

export type ActivityType = "order" | "session" | "offer" | "payment";

export type ActivityItem = {
  id: string;
  type: ActivityType;
  description: string;
  timestamp: string;
  amount?: number;
};

export type ActivityFeedProps = {
  items: ActivityItem[];
};

const TYPE_COLOR: Record<ActivityType, string> = {
  order: "var(--color-brand)",
  session: "oklch(70% 0.14 250)",
  offer: "var(--color-warning)",
  payment: "var(--color-success)",
};

const TYPE_ICON: Record<ActivityType, string> = {
  order: "■",
  session: "●",
  offer: "◆",
  payment: "▲",
};

const TYPE_LABEL: Record<ActivityType, string> = {
  order: "Pedido",
  session: "Sessão",
  offer: "Oferta",
  payment: "Pagamento",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atras`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atras`;
  const d = Math.floor(h / 24);
  return `${d}d atras`;
}

function formatCurrency(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  const visible = (items ?? []).slice(0, 10);

  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: 20,
        height: "100%",
        maxHeight: "none",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--color-brand)", margin: 0, fontFamily: "var(--font-sans)", letterSpacing: "-0.01em" }}>
          Atividade Recente
        </h3>
        <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>Últimos eventos</p>
      </div>
      {visible.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: 13,
          }}
        >
          Sem atividade recente
        </div>
      ) : (
        <div
          style={{
            position: "relative",
            paddingLeft: 24,
          }}
        >
          {/* Vertical timeline line */}
          <div
            style={{
              position: "absolute",
              left: 7,
              top: 8,
              bottom: 8,
              width: 2,
              background: "var(--color-border)",
              borderRadius: 999,
            }}
          />

          {visible.map((item, index) => {
            const color = TYPE_COLOR[item.type];
            return (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 16,
                  padding: "14px 0",
                  position: "relative",
                  transition: "opacity 200ms",
                }}
              >
                {/* Timeline dot */}
                <div
                  style={{
                    position: "absolute",
                    left: -20,
                    top: 18,
                    width: 12,
                    height: 12,
                    borderRadius: 999,
                    background: "var(--surface-2)",
                    border: `2px solid ${color}`,
                    boxShadow: `0 0 0 3px oklch(18.5% 0.004 145)`,
                    zIndex: 2,
                  }}
                />

                {/* Content */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    minWidth: 0,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--color-text)",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.description}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: 0.3,
                          color,
                          background: color + "1a",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        {TYPE_LABEL[item.type]}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-muted)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {relativeTime(item.timestamp)}
                      </span>
                    </div>
                  </div>

                  {item.amount !== undefined ? (
                    <span
                      style={{
                        fontSize: 13,
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                        color: "var(--color-text)",
                        flexShrink: 0,
                        background: "var(--color-brand-subtle)",
                        padding: "4px 10px",
                        borderRadius: 8,
                      }}
                    >
                      {formatCurrency(item.amount)}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
