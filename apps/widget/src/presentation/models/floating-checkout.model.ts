import type { CSSProperties } from "react";
import type { MerchantTheme } from "@aacp/shared-types";
import type { useThemeStudio } from "../../hooks/use-theme-studio.js";

export type FloatingCheckoutTurnModel = {
  role: "agent" | "buyer";
  text: string;
  occurredAt: string;
};

export type FloatingCheckoutModel = {
  open: boolean;
  colorMode: "light" | "dark";
  style: CSSProperties;
  theme: MerchantTheme;
  themeStudio: ReturnType<typeof useThemeStudio>;
  sessionLabel: string;
  turns: FloatingCheckoutTurnModel[];
  message: string;
  busy: boolean;
  composerDisabled: boolean;
  onToggleOpen: (open: boolean) => void;
  onMessageChange: (value: string) => void;
  onSend: () => void | Promise<void>;
};
