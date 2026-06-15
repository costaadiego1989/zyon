import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest } from "../../hooks/checkout-presentation.js";
import type { ComposerInputMeta, ComposerModel } from "../models/composer.model.js";

export function formatComposerCpf(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatComposerPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatComposerCep(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function selectComposerInputMeta(vm: CheckoutAgentViewModel): ComposerInputMeta {
  const expected = vm.activeExperience.copy.expected_input_type;
  const missing = vm.lastChat?.missing_fields?.[0];

  if (missing === "código de verificação do celular") {
    return {
      placeholder: "Código de 6 dígitos",
      inputType: "text",
      inputMode: "numeric",
      maxLength: 6,
      fieldKind: "otp",
    };
  }
  if (missing === "código de verificação") {
    return {
      placeholder: "Código de verificação do e-mail",
      inputType: "text",
      inputMode: "numeric",
      maxLength: 6,
      fieldKind: "otp",
    };
  }
  if (expected === "email" || missing === "email") {
    return {
      placeholder: "seu@email.com",
      inputType: "email",
      autoComplete: "email",
      fieldKind: "email",
    };
  }
  if (expected === "tel" || missing === "telefone" || missing === "phone") {
    return {
      placeholder: "(00) 00000-0000",
      inputType: "tel",
      inputMode: "tel",
      maxLength: 15,
      autoComplete: "tel",
      fieldKind: "phone",
    };
  }
  if (missing === "CPF" || missing === "cpf") {
    return {
      placeholder: "000.000.000-00",
      inputType: "text",
      inputMode: "numeric",
      maxLength: 14,
      fieldKind: "cpf",
    };
  }
  if (missing === "nome" || missing === "fullName") {
    return {
      placeholder: "Seu nome completo",
      inputType: "text",
      autoComplete: "name",
      fieldKind: "name",
    };
  }
  if (missing === "CEP" || missing === "cep" || missing === "zip") {
    return {
      placeholder: "00000-000",
      inputType: "text",
      inputMode: "numeric",
      maxLength: 9,
      fieldKind: "cep",
    };
  }
  if (missing === "numero_complemento" || missing === "number") {
    return {
      placeholder: "Número e complemento",
      inputType: "text",
      fieldKind: "address",
    };
  }
  if (expected === "number") {
    return {
      placeholder: "Digite o valor",
      inputType: "text",
      inputMode: "numeric",
      fieldKind: "number",
    };
  }

  return {
    placeholder: "Sua vez — quando quiser, responda",
    inputType: "text",
    fieldKind: "default",
  };
}

export function formatComposerValue(meta: ComposerInputMeta, value: string): string {
  switch (meta.fieldKind) {
    case "cpf":
      return formatComposerCpf(value);
    case "phone":
      return formatComposerPhone(value);
    case "cep":
      return formatComposerCep(value);
    case "otp":
      return value.replace(/\D/g, "").slice(0, 6);
    default:
      return value;
  }
}

export function selectComposerModel(vm: CheckoutAgentViewModel): ComposerModel | null {
  if (!vm.showComposer) return null;

  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  const meta = vm.isCartEmpty
    ? {
        placeholder: "O que você deseja comprar? Digite aqui que encontro para você",
        inputType: "text",
        fieldKind: "catalog" as const,
      }
    : selectComposerInputMeta(vm);

  return {
    agentGiven: agentName.given || vm.activeExperience.agent.name,
    message: vm.message,
    busy: vm.busy,
    composerLocked: vm.composerLocked,
    inputRef: vm.composerInputRef,
    meta,
    onChange: (value) => vm.setMessage(formatComposerValue(meta, value)),
    onSubmit: () => vm.sendMessage(),
  };
}
