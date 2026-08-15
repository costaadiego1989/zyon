import React, { useEffect, useRef } from "react";

export type OrderStatusDonutProps = {
  data: Record<string, number>;
};

type Slice = { label: string; value: number; color: string; hex: string };

const STATUS_META: Record<string, { label: string; cssVar: string; hex: string }> = {
  pending: { label: "Pendente", cssVar: "var(--warn)", hex: "#f59e0b" },
  approved: { label: "Aprovado", cssVar: "var(--accent)", hex: "#3b82f6" },
  paid: { label: "Pago", cssVar: "var(--accent)", hex: "#8b5cf6" },
  shipped: { label: "Enviado", cssVar: "var(--color-info, #6ea8ff)", hex: "#06b6d4" },
  delivered: { label: "Entregue", cssVar: "var(--good)", hex: "#22c55e" },
  cancelled: { label: "Cancelado", cssVar: "var(--danger)", hex: "#ef4444" },
};

export function OrderStatusDonut({ data }: OrderStatusDonutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  if (!data || Object.keys(data).length === 0) return null;
  const total = Object.values(data).reduce((a, b) => a + b, 0);

  const slices: Slice[] = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => {
      const meta = STATUS_META[key.toLowerCase()] ?? {
        label: key,
        cssVar: "var(--muted)",
        hex: "#888888",
      };
      return { label: meta.label, value, color: meta.cssVar, hex: meta.hex };
    });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 160;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = 68;
    const thickness = 18;

    if (total === 0 || slices.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = thickness;
      ctx.strokeStyle = "#333";
      ctx.stroke();
      return;
    }

    let start = -Math.PI / 2;
    for (const slice of slices) {
      const angle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.lineWidth = thickness;
      ctx.strokeStyle = slice.hex;
      ctx.lineCap = "butt";
      ctx.stroke();
      start += angle;
    }
  }, [data, slices, total]);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--ink)",
          margin: 0,
          fontFamily: "var(--sans)",
          letterSpacing: -0.3,
        }}
      >
        Pedidos por Status
      </h3>

      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 160,
            height: 160,
            flexShrink: 0,
          }}
        >
          <canvas ref={canvasRef} aria-label="Distribuicao de status de pedidos" />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                fontWeight: 600,
              }}
            >
              Total
            </span>
            <span
              style={{
                fontSize: 24,
                fontFamily: "var(--mono)",
                fontWeight: 700,
                color: "var(--ink)",
              }}
            >
              {total}
            </span>
          </div>
        </div>

        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: 1,
            minWidth: 130,
          }}
        >
          {slices.length === 0 ? (
            <li style={{ fontSize: 12, color: "var(--muted)" }}>Sem pedidos</li>
          ) : (
            slices.map((slice) => {
              const pct = total > 0 ? (slice.value / total) * 100 : 0;
              return (
                <li
                  key={slice.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                    color: "var(--ink)",
                    padding: "4px 0",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: slice.hex,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, fontWeight: 500 }}>{slice.label}</span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      color: "var(--muted)",
                      fontWeight: 700,
                      fontSize: 11,
                    }}
                  >
                    {slice.value}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      color: "var(--faint)",
                      fontSize: 10,
                      minWidth: 30,
                      textAlign: "right",
                    }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
