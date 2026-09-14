import { useState, type FormEvent } from "react";
import { Bug, MessageSquarePlus } from "lucide-react";
import { useApi } from "../hooks/useApi.js";
import { Button } from "./Button.js";
import { Modal } from "./Modal.js";
import { showToast } from "./Toast.js";
import type { PlatformFeedbackCategory } from "../api/endpoints/merchants.js";

const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 4000;

const feedbackCategories: Array<{ value: PlatformFeedbackCategory; label: string }> = [
  { value: "bug", label: "Bug ou erro" },
  { value: "improvement", label: "Melhoria" },
  { value: "suggestion", label: "Sugestão" },
  { value: "other", label: "Outro feedback" },
];

export function PlatformFeedbackFab() {
  const api = useApi();
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState<PlatformFeedbackCategory | "">("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const close = () => {
    if (!isSubmitting) setIsOpen(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedMessage = message.trim();

    if (!category) {
      setError("Selecione o tipo de feedback antes de enviar.");
      return;
    }

    if (normalizedMessage.length < MIN_MESSAGE_LENGTH) {
      setError(`Descreva seu feedback com pelo menos ${MIN_MESSAGE_LENGTH} caracteres.`);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await api.submitPlatformFeedback({ category, message: normalizedMessage });
      setCategory("");
      setMessage("");
      setIsOpen(false);
      showToast("success", "Recebemos seu feedback. Obrigado por ajudar a melhorar a Zyon.");
    } catch {
      setError("Não foi possível enviar seu feedback agora. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="platform-feedback-fab"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-label="Enviar feedback sobre a Zyon"
      >
        <Bug size={18} aria-hidden="true" />
        <span>Feedback</span>
      </button>

      <Modal
        isOpen={isOpen}
        onClose={close}
        presentation="floating-panel"
        eyebrow="Feedback de produto"
        title="Como podemos melhorar?"
        subtitle="Conte o que aconteceu ou compartilhe uma ideia para a Zyon."
        footer={(
          <>
            <Button variant="ghost" onClick={close} disabled={isSubmitting}>Cancelar</Button>
            <Button form="merchant-platform-feedback-form" type="submit" loading={isSubmitting}>
              <MessageSquarePlus size={15} aria-hidden="true" />
              Enviar feedback
            </Button>
          </>
        )}
      >
        <form id="merchant-platform-feedback-form" className="platform-feedback-form" onSubmit={handleSubmit} noValidate>
          <div className="platform-feedback-form__field">
            <label htmlFor="platform-feedback-category">Tipo de feedback</label>
            <select
              id="platform-feedback-category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value as PlatformFeedbackCategory);
                setError(null);
              }}
              aria-invalid={Boolean(error && !category)}
              required
            >
              <option value="" disabled>Selecione uma opção</option>
              {feedbackCategories.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="platform-feedback-form__field">
            <div className="platform-feedback-form__label-row">
              <label htmlFor="platform-feedback-message">Mensagem</label>
              <span aria-live="polite">{message.length}/{MAX_MESSAGE_LENGTH}</span>
            </div>
            <textarea
              id="platform-feedback-message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                setError(null);
              }}
              placeholder="Ex.: ao publicar um produto, a imagem não é salva e não aparece no catálogo."
              minLength={MIN_MESSAGE_LENGTH}
              maxLength={MAX_MESSAGE_LENGTH}
              aria-describedby={error ? "platform-feedback-help platform-feedback-error" : "platform-feedback-help"}
              aria-invalid={Boolean(error && message.trim().length < MIN_MESSAGE_LENGTH)}
              required
              rows={8}
            />
            <p id="platform-feedback-help" className="platform-feedback-form__help">
              Evite incluir senhas, dados de pagamento ou informações pessoais.
            </p>
          </div>

          {error && <p id="platform-feedback-error" className="platform-feedback-form__error" role="alert">{error}</p>}
        </form>
      </Modal>
    </>
  );
}
