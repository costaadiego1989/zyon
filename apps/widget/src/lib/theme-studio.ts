import { DEFAULT_MERCHANT_THEME, type MerchantTheme } from "@aacp/shared-types";
import type { GlobalAuthSession } from "./widget-schemas.js";

const LOCAL_THEME_KEY = "aacp_theme_studio_overrides";

export type ThemeStudioDraft = Partial<MerchantTheme>;

export function isLocalThemeStudioHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
}

export function isMerchantSession(session: GlobalAuthSession | null): boolean {
  if (!session?.access_token || !session.merchant_id) return false;
  return !session.global_user_id;
}

export function canUseThemeStudio(session: GlobalAuthSession | null): boolean {
  if (session?.global_user_id) return false;
  if (isMerchantSession(session)) return true;
  return isLocalThemeStudioHost();
}

export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  theme: Partial<MerchantTheme>;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "stripe-clean",
    label: "Stripe Clean",
    description: "Neutros frios, accent contido, radius moderado.",
    theme: {
      accentColor: "#0F766E",
      secondaryColor: "#1E40AF",
      textColor: "#0F172A",
      mutedTextColor: "#64748B",
      backgroundColor: "#F4F6F8",
      surfaceColor: "#FCFCFD",
      surfaceElevatedColor: "#F7F9FB",
      borderColor: "#D9E2EC",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontDisplay: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
      borderRadius: 10,
      density: "comfortable"
    }
  },
  {
    id: "concierge",
    label: "Concierge",
    description: "Tom premium, serif display, superfícies quentes.",
    theme: {
      accentColor: "#1D4ED8",
      secondaryColor: "#0F766E",
      textColor: "#1C1917",
      mutedTextColor: "#78716C",
      backgroundColor: "#FAFAF9",
      surfaceColor: "#FFFFFF",
      surfaceElevatedColor: "#F5F5F4",
      borderColor: "#E7E5E4",
      fontFamily: "\"IBM Plex Sans\", ui-sans-serif, system-ui, sans-serif",
      fontDisplay: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
      borderRadius: 12,
      density: "spacious"
    }
  },
  {
    id: "bold-retail",
    label: "Bold Retail",
    description: "Contraste alto, accent forte, layout compacto.",
    theme: {
      accentColor: "#BE123C",
      secondaryColor: "#1E3A8A",
      textColor: "#111827",
      mutedTextColor: "#6B7280",
      backgroundColor: "#F9FAFB",
      surfaceColor: "#FFFFFF",
      surfaceElevatedColor: "#F3F4F6",
      borderColor: "#D1D5DB",
      fontFamily: "\"Plus Jakarta Sans\", Inter, ui-sans-serif, system-ui, sans-serif",
      fontDisplay: "\"Plus Jakarta Sans\", Inter, ui-sans-serif, system-ui, sans-serif",
      borderRadius: 8,
      density: "compact"
    }
  }
];

export function readLocalThemeOverrides(merchantId: string): ThemeStudioDraft {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(`${LOCAL_THEME_KEY}:${merchantId}`);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ThemeStudioDraft;
  } catch {
    return {};
  }
}

export function writeLocalThemeOverrides(merchantId: string, draft: ThemeStudioDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${LOCAL_THEME_KEY}:${merchantId}`, JSON.stringify(draft));
}

export function clearLocalThemeOverrides(merchantId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${LOCAL_THEME_KEY}:${merchantId}`);
}

export function mergeThemeLayers(
  base: MerchantTheme,
  localOverrides: ThemeStudioDraft,
  liveDraft?: ThemeStudioDraft
): MerchantTheme {
  return {
    ...DEFAULT_MERCHANT_THEME,
    ...base,
    ...localOverrides,
    ...(liveDraft ?? {})
  };
}

export async function persistMerchantTheme(
  apiBaseUrl: string,
  session: GlobalAuthSession,
  theme: MerchantTheme
): Promise<MerchantTheme> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${base}/merchants/me/theme`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      "x-device-id": session.user_id ?? session.merchant_id ?? ""
    },
    credentials: "include",
    body: JSON.stringify(theme)
  });
  const payload = (await response.json().catch(() => ({}))) as MerchantTheme & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "Falha ao salvar tema do tenant.");
  }
  return payload;
}

export const THEME_COLOR_FIELDS: Array<{ key: keyof MerchantTheme; label: string }> = [
  { key: "accentColor", label: "Cor primária" },
  { key: "secondaryColor", label: "Cor secundária" },
  { key: "textColor", label: "Texto principal" },
  { key: "mutedTextColor", label: "Texto secundário" },
  { key: "backgroundColor", label: "Fundo da página" },
  { key: "surfaceColor", label: "Superfície do painel" },
  { key: "surfaceElevatedColor", label: "Superfície elevada" },
  { key: "borderColor", label: "Cor das bordas" },
  { key: "successColor", label: "Sucesso" },
  { key: "warningColor", label: "Alerta" }
];
