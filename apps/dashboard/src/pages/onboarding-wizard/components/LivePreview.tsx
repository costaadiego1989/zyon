import React from "react";
import type { ThemeDraft } from "../useOnboardingWizard.js";
import { CheckoutPreviewWidget } from "../../../components/CheckoutPreviewWidget.js";
import { DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";

interface LivePreviewProps {
  themeDraft: ThemeDraft;
}

export function LivePreview({ themeDraft }: LivePreviewProps) {
  return (
    <aside className="onb-preview">
      <CheckoutPreviewWidget
        theme={{
          ...DEFAULT_MERCHANT_THEME,
          accentColor: themeDraft.accentColor,
          secondaryColor: themeDraft.secondaryColor,
          fontFamily: themeDraft.bodyFont,
          fontDisplay: themeDraft.headingFont,
          agentName: themeDraft.agentName,
          headerTitle: themeDraft.headerTitle,
          logoUrl: themeDraft.logoUrl,
        }}
        merchantName={themeDraft.headerTitle}
      />
    </aside>
  );
}
