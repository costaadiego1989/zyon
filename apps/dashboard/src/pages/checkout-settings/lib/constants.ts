import type { CheckoutTriggerName, CheckoutSettingsMode } from "@zyon/shared-types";

export const TRIGGER_LABELS: Record<CheckoutTriggerName, string> = {
  shipping_objection_detected: "Frete alto",
  coupon_field_clicked: "Busca cupom",
  payment_failed: "Pagamento falhou",
  exit_intent_detected: "Tentativa de sair",
  idle_30_seconds: "Inatividade",
};

export const TRIGGER_HELP: Record<CheckoutTriggerName, string> = {
  shipping_objection_detected: "Comprador reclama do frete → agente oferece subsídio de frete",
  coupon_field_clicked: "Comprador abre campo de cupom → agente sugere cupom disponível",
  payment_failed: "Pagamento recusado → agente sugere método alternativo",
  exit_intent_detected: "Cursor sai da página → agente pergunta se pode ajudar",
  idle_30_seconds: "30s sem interação → agente oferece ajuda proativa",
};

export const TRIGGER_STATUS: Record<CheckoutTriggerName, "active" | "soon"> = {
  exit_intent_detected: "active",
  idle_30_seconds: "active",
  shipping_objection_detected: "soon",
  coupon_field_clicked: "soon",
  payment_failed: "active",
};

export const ALL_TRIGGERS: CheckoutTriggerName[] = [
  "exit_intent_detected",
  "idle_30_seconds",
  "payment_failed",
];

export const TRIGGER_FIXED_PRIORITIES: Record<CheckoutTriggerName, number> = {
  shipping_objection_detected: 100,
  payment_failed: 90,
  coupon_field_clicked: 80,
  exit_intent_detected: 70,
  idle_30_seconds: 60,
};

export const PROGRESSIVE_PRESETS = {
  conservative: { initial_coupon: 5, exit_intent: 7, abandoned_cart: 10, payment_nudge: 5 },
  moderate: { initial_coupon: 7, exit_intent: 10, abandoned_cart: 15, payment_nudge: 7 },
  aggressive: { initial_coupon: 10, exit_intent: 15, abandoned_cart: 20, payment_nudge: 10 },
} as const;

export type ProgressiveLevel = "conservative" | "moderate" | "aggressive";

export interface ModeOption {
  value: CheckoutSettingsMode;
  label: string;
  desc: string;
  iconName: "Radio" | "Eye" | "EyeOff";
  isDefault: boolean;
}

export const MODE_OPTIONS: ModeOption[] = [
  {
    value: "silent_until_trigger",
    label: "Esperar sinal",
    desc: "Agente espera um sinal do comprador para agir",
    iconName: "Radio",
    isDefault: true,
  },
  {
    value: "proactive",
    label: "Iniciar sozinho",
    desc: "Agente inicia contato quando identifica oportunidade",
    iconName: "Eye",
    isDefault: false,
  },
  {
    value: "manual_only",
    label: "Só manual",
    desc: "Agente só responde quando chamado",
    iconName: "EyeOff",
    isDefault: false,
  },
];
