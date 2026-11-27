"use client";

import { useId, type CSSProperties } from "react";
import { DEFAULT_AGENT_APPEARANCE, type ShoppingAgentAppearance } from "@zyon/shared-types";
import styles from "./AgentAvatar.module.css";

export const AVATAR_COLORS = {
  jade: { label: "Jade", base: "#4b8b78", light: "#d8eee3", ink: "#183e33" },
  ocean: { label: "Oceano", base: "#547aa4", light: "#dce8f7", ink: "#1d3655" },
  lilac: { label: "Lavanda", base: "#8b76af", light: "#eae2f5", ink: "#44305f" },
  terracotta: { label: "Terracota", base: "#b7795d", light: "#f6e1d5", ink: "#603b2c" },
  graphite: { label: "Grafite", base: "#747d86", light: "#e6e9ec", ink: "#303943" },
  rose: { label: "Rosé", base: "#b57c91", light: "#f6e1e9", ink: "#61364a" },
} as const;
export const AVATAR_STYLES: Record<ShoppingAgentAppearance["style"], string> = { aura: "Aura", orbit: "Órbita", visor: "Nexo", initials: "Inicial" };
export const AVATAR_EXPRESSIONS: Record<ShoppingAgentAppearance["expression"], string> = { friendly: "Sereno", focused: "Focado", happy: "Sorridente" };

export function AgentAvatar({ appearance = DEFAULT_AGENT_APPEARANCE, name, size = 88, decorative = false }: {
  appearance?: ShoppingAgentAppearance; name: string; size?: number; decorative?: boolean;
}) {
  const id = `agent-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const color = AVATAR_COLORS[appearance.color] ?? AVATAR_COLORS.jade;
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join("").toLocaleUpperCase("pt-BR") || "A";
  const visor = appearance.style === "visor";
  const ink = visor ? color.light : color.ink;
  const offset = appearance.style === "orbit" ? 2 : 0;
  return <span className={styles.avatar} style={{ "--agent-avatar-size": `${size}px` } as CSSProperties}>
    <svg viewBox="0 0 96 96" role={decorative ? undefined : "img"} aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Avatar de ${name}: ${AVATAR_STYLES[appearance.style]}, ${color.label}, ${AVATAR_EXPRESSIONS[appearance.expression]}`}>
      <defs>
        <radialGradient id={id} cx="30%" cy="18%" r="85%"><stop stopColor="#ffffff" /><stop offset=".42" stopColor={color.light} /><stop offset="1" stopColor={color.base} /></radialGradient>
        <linearGradient id={`${id}-edge`} x2=".8" y2="1"><stop stopColor={color.light} /><stop offset="1" stopColor={color.base} /></linearGradient>
      </defs>
      {appearance.style === "orbit" && <ellipse cx="48" cy="51" rx="43" ry="17" transform="rotate(-28 48 51)" fill="none" stroke={color.base} strokeWidth="2" opacity=".65" />}
      {visor ? <><rect x="17" y="18" width="62" height="62" rx="23" fill={`url(#${id})`} /><rect x="26" y="34" width="44" height="29" rx="12" fill={color.ink} />
        <path d="M33 23h20" stroke="white" strokeWidth="2" strokeLinecap="round" opacity=".75" /></>
        : <><circle cx="48" cy={48 + offset} r={appearance.style === "orbit" ? 29 : 35} fill={`url(#${id})`} />
          <path d={appearance.style === "orbit" ? "M29 35c5-7 12-10 20-9" : "M24 31c6-10 16-14 28-13"} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" opacity=".8" /></>}
      {appearance.style === "initials" ? <text x="48" y="56" textAnchor="middle" fontSize="24" fontWeight="600" fontFamily="inherit" fill={color.ink}>{initials}</text>
        : <g transform={`translate(0 ${offset})`} fill={ink} stroke={ink} strokeLinecap="round" strokeWidth="2.5">
          {appearance.expression === "happy" ? <><path d="M35 45q4-6 8 0M53 45q4-6 8 0" fill="none" /><path d="M42 55q6 8 12 0" fill="none" /></>
            : appearance.expression === "focused" ? <><path d="M35 44h8M53 44h8" /><path d="M44 56h8" /></>
              : <><ellipse cx="39" cy="44" rx="2" ry="3.5" stroke="none" /><ellipse cx="57" cy="44" rx="2" ry="3.5" stroke="none" /><path d="M44 56q4 3 8 0" fill="none" /></>}
        </g>}
      {appearance.style === "orbit" && <circle cx="83" cy="28" r="4" fill={`url(#${id}-edge)`} />}
    </svg>
  </span>;
}

export function AgentIcon({ name, size = 18 }: { name: "plus" | "edit" | "settings" | "arrow" | "back" | "clock" | "price_watch" | "restock" | "reorder" | "negotiate" | "basket_budget"; size?: number }) {
  const paths = {
    plus: "M12 5v14M5 12h14", edit: "m16 3 5 5M4 20l4-1L21 6l-4-4L4 15v5Z", settings: "M4 7h7M15 7h5M4 17h3M11 17h9M11 4v6M7 14v6",
    arrow: "M5 12h14m-5-5 5 5-5 5", back: "M19 12H5m5-5-5 5 5 5", clock: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    price_watch: "m3 16 6-6 4 4 8-10M15 4h6v6", restock: "m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10",
    reorder: "M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5",
    negotiate: "M4 4h7l9 9-7 7-9-9V4Zm4 4h.01", basket_budget: "m3 8 3 12h12l3-12H3Zm5 0 4-6 4 6M9 12v4m6-4v4",
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
