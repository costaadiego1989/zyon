import { Send, Sparkles, Mail, Phone, Hash, User, MapPin, KeyRound } from "lucide-react";
import type { ComposerInputMeta, ComposerModel } from "../../presentation/models/composer.model.js";

function inputIcon(meta: ComposerInputMeta) {
  switch (meta.fieldKind) {
    case "catalog":
    case "default":
      return <Sparkles size={14} />;
    case "email":
      return <Mail size={14} />;
    case "phone":
      return <Phone size={14} />;
    case "cpf":
    case "number":
      return <Hash size={14} />;
    case "name":
      return <User size={14} />;
    case "cep":
    case "address":
      return <MapPin size={14} />;
    case "otp":
      return <KeyRound size={14} />;
    default:
      return <Sparkles size={14} />;
  }
}

export function Composer({ model }: { model: ComposerModel }) {
  return (
    <div className="aacp-composer-wrap">
      <div className="aacp-composer-inline">
        <div className="aacp-agent-tag" aria-hidden="true">
          <Sparkles size={12} />
          {model.agentGiven} · IA
        </div>

        <form
          className="aacp-composer aacp-composer-form"
          onSubmit={(e) => {
            e.preventDefault();
            void model.onSubmit();
          }}
        >
          <span className="aacp-input-icon" aria-hidden="true">
            {inputIcon(model.meta)}
          </span>
          <input
            ref={model.inputRef}
            className="aacp-input"
            type={model.meta.inputType}
            inputMode={model.meta.inputMode as React.HTMLAttributes<HTMLInputElement>["inputMode"]}
            placeholder={model.busy ? "Aguarde..." : model.meta.placeholder}
            value={model.message}
            onChange={(e) => model.onChange(e.target.value)}
            disabled={model.composerLocked}
            aria-label="Mensagem para o assistente"
            autoComplete={model.meta.autoComplete || "off"}
            maxLength={model.meta.maxLength}
          />
          <button
            type="button"
            className="aacp-send"
            disabled={!model.message.trim() || model.composerLocked}
            aria-label="Enviar mensagem"
            onClick={() => {
              if (!model.message.trim() || model.composerLocked) return;
              void model.onSubmit();
            }}
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
