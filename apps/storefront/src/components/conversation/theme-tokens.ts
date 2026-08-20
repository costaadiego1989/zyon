export const THEME_TOKENS = {
  dark: {
    "--aacp-bg": "#08080c",
    "--aacp-surface": "#0f0f16",
    "--aacp-surface-2": "rgba(255, 255, 255, 0.05)",
    "--aacp-surface-3": "rgba(255, 255, 255, 0.08)",
    "--aacp-fg": "#f5f5f7",
    "--aacp-muted": "#8b8b95",
    "--aacp-faint": "#6c6a72",
    "--aacp-line": "rgba(255, 255, 255, 0.1)",
    "--aacp-line-strong": "rgba(255, 255, 255, 0.12)",
    "--aacp-card": "rgba(255, 255, 255, 0.05)",
    "--aacp-success": "#34d399",
    "--aacp-panel-bg": "#0f0f16",
    "--aacp-shell-bg": "#08080c",
  },
  light: {
    "--aacp-bg": "#ffffff",
    "--aacp-surface": "#ffffff",
    "--aacp-surface-2": "#f6f5f2",
    "--aacp-surface-3": "#efeee9",
    "--aacp-fg": "#141418",
    "--aacp-muted": "#71717a",
    "--aacp-faint": "#9a978e",
    "--aacp-line": "rgba(15, 15, 25, 0.09)",
    "--aacp-line-strong": "rgba(15, 15, 25, 0.1)",
    "--aacp-card": "#f7f6f3",
    "--aacp-success": "#10b981",
    "--aacp-panel-bg": "#ffffff",
    "--aacp-shell-bg": "#ffffff",
  },
} as const;

export type Theme = keyof typeof THEME_TOKENS;
