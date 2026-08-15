import React, { useEffect, useRef } from "react";

export type OrderStatusDonutProps = {
  data: Record<string, number>;
};

type Slice = { label: string; value: number; color: string; cssVar: string };

const STATUS_META: Record<string, { label: string; cssVar: string }> = {
  pending: { label: "Pendente", cssVar: "var(--warn)" },
  paid: { label: "Pago", cssVar: "var(--accent)" },
  shipped: { label: "Enviado", cssVar: "var(--color-info, #6ea8ff)" },
  delivered: { label: "Entregue", cssVar: "var(--good)" },
  cancelled: { label: "Cancelado", cssVar: "var(--danger)" },
};

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function OrderStatusDonut({ data }: OrderStatusDonutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  if (!data || Object.keys(data).length === 0) return null;
  const total = Object.values(data).reduce((a, b) => a + b, 0);

  const slices: Slice[] = Object.entries(data)
    .filter(([, v]) => v > 0)
    .map(([key, value]) => {
      const meta = STATUS_META[key] ?? { label: key, cssVar: "var(--muted)" };
      return { label: meta.label, value, color: meta.cssVar, cssVar: meta.cssVar };
    });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 180;
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
    const radius = 80;
    const thickness = 22;

    if (total === 0 || slices.length === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.lineWidth = thickness;
      ctx.strokeStyle = readCssVar("--border", "#333");
      ctx.stroke();
      return;
    }

    let start = -Math.PI / 2;
    for (const slice of slices) {
      const angle = (slice.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + angle);
      ctx.lineWidth = thickness;
      ctx.strokeStyle = readCssVar(slice.cssVar.replace("var(", "").replace(")", ""), slice.color);
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
        padding: 16,
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div style={{ position: "relative", width: 180, height: 180, flexShrink: 0 }}>
        <canvas ref={canvasRef} aria-label="Distribuição de status de pedidos" />
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
          <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Total
          </span>
          <span style={{ fontSize: 26, fontFamily: "var(--mono)", fontWeight: 600, color: "var(--ink)" }}>
            {total}
          </span>
        </div>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 140 }}>
        {slices.length === 0 ? (
          <li style={{ fontSize: 12, color: "var(--muted)" }}>Sem pedidos</li>
        ) : (
          slices.map((slice) => {
            const pct = total > 0 ? (slice.value / total) * 100 : 0;
            return (
              <li
                key={slice.label}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink)" }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: slice.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{slice.label}</span>
                <span style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontWeight: 600 }}>
                  {slice.value} · {pct.toFixed(0)}%
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
