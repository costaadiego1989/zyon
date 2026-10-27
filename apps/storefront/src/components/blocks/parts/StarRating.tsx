"use client";

export function StarRating({ value, count }: { value: number; count: number }) {
  const full = Math.floor(value);
  const partial = Math.max(0, Math.min(1, value - full));
  const total = 5;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        color: "var(--aacp-muted)",
      }}
      aria-label={`Avaliação ${value.toFixed(1)} de 5`}
    >
      <span
        style={{
          display: "inline-flex",
          gap: "1px",
          color: "#F5B301",
          fontSize: "13px",
          lineHeight: 1,
          letterSpacing: "0.5px",
        }}
        aria-hidden
      >
        {Array.from({ length: total }).map((_, i) => {
          let fillRatio = 0;
          if (i < full) fillRatio = 1;
          else if (i === full) fillRatio = partial;
          const empty = fillRatio === 0;
          return (
            <span
              key={i}
              style={{ position: "relative", display: "inline-block" }}
            >
              <span style={{ color: "rgba(245, 179, 1, 0.22)" }}>★</span>
              {!empty && (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${fillRatio * 100}%`,
                    overflow: "hidden",
                    color: "#F5B301",
                    whiteSpace: "nowrap",
                  }}
                >
                  ★
                </span>
              )}
            </span>
          );
        })}
      </span>
      <span style={{ fontWeight: 600, color: "var(--aacp-fg)" }}>
        {value.toFixed(1)}
      </span>
      <span style={{ color: "var(--aacp-muted)" }}>
        ({count} {count === 1 ? "avaliação" : "avaliações"})
      </span>
    </div>
  );
}
