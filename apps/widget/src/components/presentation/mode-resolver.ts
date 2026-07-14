import type { CheckoutWidgetPosition, CheckoutWidgetPresentationMode } from "@zyon/shared-types";

export type PresentationMode = CheckoutWidgetPresentationMode;
export type Position = CheckoutWidgetPosition | "top_right" | "top_left";

export interface PresentationConfigInput {
  presentationMode?: PresentationMode;
  position: CheckoutWidgetPosition;
  fabColor?: string;
  inviteText?: string;
  showCartBadge?: boolean;
  accentColor?: string;
}

export const VALID_MODES: readonly PresentationMode[] = [
  "fab",
  "mini_card",
  "bottom_banner",
  "trigger_only",
  "inline"
] as const;

const DEFAULT_INVITE_TEXT = "Posso ajudar?";
const DEFAULT_FAB_COLOR = "#3b82f6";
const POSITION_OFFSET = "24px";

export function resolvePresentationMode(input: PresentationConfigInput): PresentationMode {
  if (!input.presentationMode) return "fab";
  if (VALID_MODES.includes(input.presentationMode as PresentationMode)) {
    return input.presentationMode as PresentationMode;
  }
  return "fab";
}

export function resolvePositionStyles(position: Position): React.CSSProperties {
  switch (position) {
    case "bottom_right":
      return { position: "fixed", right: POSITION_OFFSET, bottom: POSITION_OFFSET };
    case "bottom_left":
      return { position: "fixed", left: POSITION_OFFSET, bottom: POSITION_OFFSET };
    case "top_right":
      return { position: "fixed", right: POSITION_OFFSET, top: POSITION_OFFSET };
    case "top_left":
      return { position: "fixed", left: POSITION_OFFSET, top: POSITION_OFFSET };
    default:
      return { position: "fixed", right: POSITION_OFFSET, bottom: POSITION_OFFSET };
  }
}

export function resolveFabColor(input: PresentationConfigInput): string {
  if (input.fabColor && /^#[0-9a-f]{6}$/i.test(input.fabColor)) return input.fabColor;
  if (input.accentColor && /^#[0-9a-f]{6}$/i.test(input.accentColor)) return input.accentColor;
  return DEFAULT_FAB_COLOR;
}

export function resolveInviteText(input: PresentationConfigInput): string {
  const value = input.inviteText?.trim();
  return value && value.length > 0 ? value : DEFAULT_INVITE_TEXT;
}

export function resolveShowCartBadge(input: PresentationConfigInput): boolean {
  return input.showCartBadge !== false;
}
