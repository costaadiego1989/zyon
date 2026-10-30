export const AGENT_AVATAR_STYLES = ["aura", "orbit", "visor", "initials"] as const;
export const AGENT_AVATAR_COLORS = ["jade", "ocean", "lilac", "terracotta", "graphite", "rose"] as const;
export const AGENT_AVATAR_EXPRESSIONS = ["friendly", "focused", "happy"] as const;

export interface ShoppingAgentAppearance {
  version: 1;
  style: typeof AGENT_AVATAR_STYLES[number];
  color: typeof AGENT_AVATAR_COLORS[number];
  expression: typeof AGENT_AVATAR_EXPRESSIONS[number];
}

export const DEFAULT_AGENT_APPEARANCE: ShoppingAgentAppearance = {
  version: 1, style: "aura", color: "jade", expression: "friendly",
};
