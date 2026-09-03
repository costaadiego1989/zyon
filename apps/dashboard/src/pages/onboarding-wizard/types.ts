import type { MerchantTheme } from "@zyon/shared-types";
import type { LucideIcon } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export type ThemeDraft = Pick<MerchantTheme, "accentColor" | "logoUrl" | "headerTitle" | "agentName"> & {
  secondaryColor: string;
  headingFont: string;
  bodyFont: string;
  originZip: string;
  storeCategory: string;
};

export type AddressDraft = {
  zip: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type PaymentDraft = {
  stripeStatus: "idle" | "pending" | "active";
  asaasApiKey: string;
  asaasStatus: "idle" | "testing" | "pending" | "active" | "error";
  mercadopagoStatus: "idle" | "connecting" | "pending" | "active";
  cryptoEnabled: boolean;
  walletAddress: string;
};

export type PlatformChoice = "native" | "woocommerce" | "magento" | "vtex";

export type IntegrationDraft = {
  platform: PlatformChoice;
};

export type StepMeta = {
  id: number;
  label: string;
  caption: string;
  icon: LucideIcon;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isValidEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}
