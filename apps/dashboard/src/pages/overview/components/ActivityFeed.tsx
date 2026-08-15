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
  order: "var(--accent)",
  session: "var(--color-info, #6ea8ff)",
  offer: "var(--warn)",
  payment: "var(--good)",
};

const TYPE_ICON: Record<ActivityType, string> = {
  order: "�",
  session: "◌",
  offer: "%",
  payment: "$",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function formatCurrency(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  const visible = (items ?? []).slice(0, 10);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 12,
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      {visible.length === 0 ? (
        <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Sem atividade recente</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {visible.map((item) => {
            const color = TYPE_COLOR[item.type];
            return (
              <li
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 6px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: "var(--color-surface-alt)",
                    color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--mono)",
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {TYPE_ICON[item.type]}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.description}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                    {relativeTime(item.timestamp)}
                  </div>
                </div>
                {item.amount !== undefined ? (
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "var(--mono)",
                      fontWeight: 600,
                      color: "var(--ink)",
                      flexShrink: 0,
                    }}
                  >
                    {formatCurrency(item.amount)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
