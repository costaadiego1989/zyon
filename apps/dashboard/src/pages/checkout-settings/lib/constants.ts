import type { CheckoutTriggerName, CheckoutSettingsMode } from "@zyon/shared-types";

export const ALL_TRIGGERS: CheckoutTriggerName[] = [
  "shipping_objection_detected",
  "coupon_field_clicked",
  "payment_failed",
  "exit_intent_detected",
  "idle_30_seconds",
];

export const TRIGGER_LABELS: Record<CheckoutTriggerName, string> = {
  shipping_objection_detected: "Objeção de frete",
  coupon_field_clicked: "Campo de cupom clicado",
  payment_failed: "Pagamento falhou",
  exit_intent_detected: "Intenção de saída detectada",
  idle_30_seconds: "30s sem interação",
};

export const TRIGGER_HELP: Record<CheckoutTriggerName, string> = {
  shipping_objection_detected: "Comprador hesita no custo ou prazo de entrega.",
  coupon_field_clicked: "Comprador procura por um cupom de desconto.",
  payment_failed: "A tentativa de pagamento foi recusada ou expirou.",
  exit_intent_detected: "O cursor indica intenção de sair da página.",
  idle_30_seconds: "Nenhuma interação por 30 segundos seguidos.",
};

export const MODE_OPTIONS: {
  value: CheckoutSettingsMode;
  label: string;
  desc: string;
  isDefault: boolean;
}[] = [
  {
    value: "silent_until_trigger",
    label: "Silencioso até o gatilho",
    desc: "Aguarda um gatilho antes de agir. Recomendado para a maioria dos casos.",
    isDefault: true,
  },
  {
    value: "proactive",
    label: "Proativo",
    desc: "Inicia a conversa automaticamente após o atraso inicial configurado.",
    isDefault: false,
  },
  {
    value: "manual_only",
    label: "Somente manual",
    desc: "O comprador abre o widget manualmente. Sem intervenções automáticas.",
    isDefault: false,
  },
];

export const ALLOWED_SUPPRESSED_STEPS = [
  "payment",
  "review",
  "shipping",
  "identification",
] as const;

export const BRAZILIAN_UF_CODES = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO",
  "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR",
  "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;
