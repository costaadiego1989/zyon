"use client";

import { createContext, useContext } from "react";

export interface WidgetConfig {
  mode: "silent_until_trigger" | "proactive" | "manual_only";
  position?: "bottom_right" | "bottom_left" | "top_right" | "top_left";
  fabColor?: string;
  inviteText?: string;
  presentationMode?: "fab" | "banner" | "inline";
  cartPresentationMode?: "floating" | "page" | "redirect";
  budgetModeEnabled?: boolean;
  startMinimized?: boolean;
  initialDelaySeconds?: number;
  showCartBadge?: boolean;
  fabClickAction?: string;
  fabRedirectUrl?: string;
  openWidgetOnTrigger: boolean;
  enabledTriggers: string[];
  triggerMessages?: Record<string, { message: string; couponCode?: string }>;
  suppressedSteps: string[];
  blockedRegions: string[];
  minimumCartValue?: number;
  handoffEnabled: boolean;
  handoffMessage: string;
  handoffChannels: string[];
  cooldownSeconds?: number;
  maxInterventionsPerSession?: number;
  maxDiscountPercent?: number;
  progressiveDiscount?: { enabled: boolean; stages: Record<string, number> };
}
export interface WidgetConfigState {
  config: WidgetConfig | null;
  loading: boolean;
  error: string | null;
}
const DEFAULT_STATE: WidgetConfigState = {
  config: null,
  loading: true,
  error: null,
};
export const WidgetConfigContext = createContext<WidgetConfigState>(DEFAULT_STATE);

export function useWidgetConfig(): WidgetConfigState {
  return useContext(WidgetConfigContext);
}
