import React from "react";
import type { MerchantProfile, MerchantTheme } from "../../../api-client.js";
import { ThemePreviewCard } from "../../theme-page/components/ThemePreviewCard.js";
import type { ThemeDraft } from "../types.js";

interface LivePreviewProps {
  apiBaseUrl: string;
  me: MerchantProfile;
  themeDraft: ThemeDraft;
}

/**
 * Live preview for the onboarding wizard — a native React replica of the
 * storefront intro, identical to the theme page's preview. Reactive to the
 * theme being edited (no iframe / widget bundle, which collapsed to a black
 * body when the store wasn't configured yet). Maps the wizard's ThemeDraft to
 * a MerchantTheme so ThemePreviewCard renders the agent hero live.
 */
export function LivePreview({ me, themeDraft }: LivePreviewProps) {
  const theme = draftToTheme(themeDraft);
  const storeName = themeDraft.headerTitle?.trim() || me.name || "Sua loja";

  return (
    <aside className="onb-preview">
      <div className="onb-preview-frame">
        <ThemePreviewCard theme={theme} storeName={storeName} />
      </div>
    </aside>
  );
}

/**
 * The wizard collects a small ThemeDraft (accent, secondary, fonts, logo,
 * agent name). Map it onto the fields ThemePreviewCard reads; everything else
 * falls back to the card's own defaults.
 */
function draftToTheme(draft: ThemeDraft): MerchantTheme {
  return {
    accentColor: draft.accentColor || "#0F766E",
    secondaryColor: draft.secondaryColor || draft.accentColor || "#1E40AF",
    fontDisplay: draft.headingFont,
    fontFamily: draft.bodyFont,
    logoUrl: draft.logoUrl || undefined,
    headerTitle: draft.headerTitle || undefined,
    agentName: draft.agentName || "Assistente",
  } as MerchantTheme;
}
