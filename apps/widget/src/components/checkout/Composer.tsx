import { Send, Sparkles, Mail, Phone, CreditCard, Hash, User, MapPin, KeyRound } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { agentGivenAndRest } from "../../hooks/checkout-view-model.js";

function getInputMeta(vm: CheckoutAgentViewModel): {
  placeholder: string;
  inputType: string;
  icon: React.ReactNode;
  inputMode?: string;
  maxLength?: number;
  autoComplete?: string;
} {
  const expected = vm.activeExperience.copy.expected_input_type;
  const missing = vm.lastChat?.missing_fields?.[0];

  // OTP checks FIRST — must not be overridden by expected_input_type
  if (missing === "código de verificação do celular") {
    return {
      placeholder: "Código de 6 dígitos",
      inputType: "text",
      icon: <KeyRound size={14} />,
      inputMode: "numeric",
      maxLength: 6
    };
  }
  if (missing === "código de verificação") {
    return {
      placeholder: "Código de verificação do e-mail",
      inputType: "text",
      icon: <KeyRound size={14} />,
      inputMode: "numeric",
      maxLength: 6
    };
  }

  if (expected === "email" || missing === "email") {
    return {
      placeholder: "seu@email.com",
      inputType: "email",
      icon: <Mail size={14} />,
      autoComplete: "email"
    };
  }
  if (expected === "tel" || missing === "telefone" || missing === "phone") {
    return {
      placeholder: "(00) 00000-0000",
      inputType: "tel",
      icon: <Phone size={14} />,
      inputMode: "tel",
      maxLength: 15,
      autoComplete: "tel"
    };
  }
  if (missing === "CPF" || missing === "cpf") {
    return {
      placeholder: "000.000.000-00",
      inputType: "text",
      icon: <Hash size={14} />,
      inputMode: "numeric",
      maxLength: 14
    };
  }
  if (missing === "nome" || missing === "fullName") {
    return {
      placeholder: "Seu nome completo",
      inputType: "text",
      icon: <User size={14} />,
      autoComplete: "name"
    };
  }
  if (missing === "CEP" || missing === "cep" || missing === "zip") {
    return {
      placeholder: "00000-000",
      inputType: "text",
      icon: <MapPin size={14} />,
      inputMode: "numeric",
      maxLength: 9
    };
  }
  if (missing === "numero_complemento" || missing === "number") {
    return {
      placeholder: "Número e complemento",
      inputType: "text",
      icon: <MapPin size={14} />
    };
  }
  if (expected === "number") {
    return {
      placeholder: "Digite o valor",
      inputType: "text",
      icon: <Hash size={14} />,
      inputMode: "numeric"
    };
  }

  return {
    placeholder: "Sua vez — quando quiser, responda",
    inputType: "text",
    icon: <Sparkles size={14} />
  };
}

/** Formats CPF as 000.000.000-00 */
function formatCPF(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Formats phone as (00) 00000-0000 */
function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/** Formats CEP as 00000-000 */
function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function Composer({ vm }: { vm: CheckoutAgentViewModel }) {
  if (!vm.showComposer) return null;

  const agentName = agentGivenAndRest(vm.activeExperience.agent.name);
  const meta = vm.isCartEmpty
    ? {
        placeholder: "O que você deseja comprar? Digite aqui que encontro para você",
        inputType: "text",
        icon: <Sparkles size={14} />,
        inputMode: undefined,
        maxLength: undefined,
        autoComplete: undefined
      }
    : getInputMeta(vm);
  const missing = vm.lastChat?.missing_fields?.[0];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (missing === "CPF" || missing === "cpf") val = formatCPF(val);
    else if (missing === "telefone" || missing === "phone") val = formatPhone(val);
    else if (missing === "CEP" || missing === "cep" || missing === "zip") val = formatCEP(val);
    else if (missing === "código de verificação do celular" || missing === "código de verificação") val = val.replace(/\D/g, "").slice(0, 6);
    vm.setMessage(val);
  };

  return (
    <div className="aacp-composer-wrap">
      <div className="aacp-composer-inline">
        <div className="aacp-agent-tag" aria-hidden="true">
          <Sparkles size={12} />
          {agentName.given} · IA
        </div>

        <form
          className="aacp-composer aacp-composer-form"
          onSubmit={(e) => {
            e.preventDefault();
            void vm.sendMessage();
          }}
        >
          <span className="aacp-input-icon" aria-hidden="true">{meta.icon}</span>
          <input
            ref={vm.composerInputRef}
            className="aacp-input"
            type={meta.inputType}
            inputMode={meta.inputMode as any}
            placeholder={vm.busy ? "Aguarde..." : meta.placeholder}
            value={vm.message}
            onChange={handleChange}
            disabled={vm.composerLocked}
            aria-label="Mensagem para o assistente"
            autoComplete={meta.autoComplete || "off"}
            maxLength={meta.maxLength}
          />
          <button
            type="submit"
            className="aacp-send"
            disabled={!vm.message.trim() || vm.composerLocked}
            aria-label="Enviar mensagem"
          >
            <Send size={18} />
          </button>
        </form>

        <div className="aacp-composer-hint-inline" aria-hidden="true">
          <Sparkles size={11} />
          Pressione Enter para enviar
        </div>
      </div>
    </div>
  );
}
