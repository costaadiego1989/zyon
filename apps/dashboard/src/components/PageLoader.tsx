import React from "react";

/**
 * PageLoader — Enterprise skeleton loader for page transitions.
 * Shows animated placeholder blocks that mirror a typical page layout:
 * header + KPI grid + content area.
 *
 * Usage:
 *   <PageLoader />                    — full page skeleton
 *   <PageLoader variant="section" />  — smaller, for inline sections
 */

export interface PageLoaderProps {
  variant?: "page" | "section";
}

export function PageLoader({ variant = "page" }: PageLoaderProps) {
  if (variant === "section") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "20px 0" }} aria-busy="true" aria-label="Carregando">
        <div style={{ ...shimmerBlock, height: 14, width: "40%", borderRadius: 6 }} />
        <div style={{ ...shimmerBlock, height: 48, borderRadius: 8 }} />
        <div style={{ ...shimmerBlock, height: 48, borderRadius: 8, opacity: 0.6 }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "4px 0" }} aria-busy="true" aria-label="Carregando página">
      {/* Header skeleton */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ ...shimmerBlock, height: 10, width: 80, borderRadius: 4 }} />
        <div style={{ ...shimmerBlock, height: 22, width: 220, borderRadius: 6 }} />
        <div style={{ ...shimmerBlock, height: 12, width: 300, borderRadius: 4, opacity: 0.5 }} />
      </div>

      {/* KPI grid skeleton */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ ...cardBlock, animationDelay: `${i * 0.1}s` }}>
            <div style={{ ...shimmerBlock, height: 10, width: "50%", borderRadius: 4, marginBottom: 10 }} />
            <div style={{ ...shimmerBlock, height: 24, width: "60%", borderRadius: 6 }} />
          </div>
        ))}
      </div>

      {/* Content block skeleton */}
      <div style={{ ...cardBlock, minHeight: 200, animationDelay: "0.5s" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 4 }}>
          <div style={{ ...shimmerBlock, height: 12, width: "30%", borderRadius: 4 }} />
          <div style={{ ...shimmerBlock, height: 40, borderRadius: 8 }} />
          <div style={{ ...shimmerBlock, height: 40, borderRadius: 8, opacity: 0.6 }} />
          <div style={{ ...shimmerBlock, height: 40, borderRadius: 8, opacity: 0.35 }} />
        </div>
      </div>

      <style>{`
        @keyframes skeletonShimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        @keyframes skeletonFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

const shimmerBlock: React.CSSProperties = {
  background: "linear-gradient(90deg, var(--surface-2) 25%, color-mix(in srgb, var(--color-border) 40%, var(--surface-2)) 50%, var(--surface-2) 75%)",
  backgroundSize: "800px 100%",
  animation: "skeletonShimmer 1.8s ease-in-out infinite",
  borderRadius: 6,
};

const cardBlock: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "18px 20px",
  animation: "skeletonFadeIn 0.4s ease both",
};
