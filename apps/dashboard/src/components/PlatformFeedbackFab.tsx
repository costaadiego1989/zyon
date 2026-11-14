import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bug, MessageSquarePlus, MessagesSquare } from "lucide-react";
import { createPlatformSupportClient, PlatformSupportDesk } from "@zyon/platform-support-ui";
import type { PlatformSupportCapabilities } from "@zyon/shared-types";
import { dashboardJson } from "../api/http/client.js";
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

export function PlatformFeedbackFab({ apiBaseUrl, merchantId }: { apiBaseUrl: string; merchantId: string }) {
  const api = useApi();
  const supportClient = useMemo(() => createPlatformSupportClient({ baseUrl: apiBaseUrl, kind: "merchant", request: <T,>(path: string, init?: { method?: string; body?: string }) => dashboardJson<T>(apiBaseUrl, path, { ...init, ...(init?.body ? { headers: { "Content-Type": "application/json" } } : {}) }) }), [apiBaseUrl, merchantId]);
  const [supportOpen, setSupportOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<PlatformSupportCapabilities | null>(null);
  const [unread, setUnread] = useState(0);
  const [hasTickets, setHasTickets] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => {
      void Promise.all([supportClient.capabilities(), supportClient.list()]).then(([access, page]) => {
        if (!active) return;
        setCapabilities(access); setHasTickets(page.items.length > 0);
        setUnread(page.items.reduce((sum, ticket) => sum + ticket.unreadCount, 0));
      }).catch(() => { /* The support panel exposes source errors with a retry action. */ });
    };
    load();
    const unsubscribe = supportClient.subscribe({ changed: load, state: () => {} });
    const timer = setInterval(load, 30_000);
    return () => { active = false; unsubscribe(); clearInterval(timer); };
  }, [supportClient]);
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
        onClick={() => capabilities?.canOpen || hasTickets || !capabilities ? setSupportOpen(true) : setIsOpen(true)}
        aria-haspopup="dialog"
        aria-label={unread ? `Ajuda e feedback, ${unread} mensagens não lidas` : "Ajuda e feedback sobre a Zyon"}
      >
        <Bug size={18} aria-hidden="true" />
        <span>Ajuda e feedback</span>
        {unread > 0 && <span className="platform-support-unread">{unread}</span>}
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
        <Button variant="outline" onClick={() => { setIsOpen(false); setSupportOpen(true); }}>
          <MessagesSquare size={16} aria-hidden="true" />Atendimento técnico e meus chamados
        </Button>
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
      <Modal isOpen={supportOpen} onClose={() => setSupportOpen(false)} presentation="center" size="lg" eyebrow={capabilities?.tier === "priority" ? "Escala · atendimento prioritário" : "Suporte Zyon"} title="Atendimento técnico" subtitle="Converse com a equipe e acompanhe seus chamados." footer={<Button variant="ghost" onClick={() => { setSupportOpen(false); setIsOpen(true); }}>Enviar sugestão ou outro feedback</Button>}>
        <PlatformSupportDesk key={merchantId} client={supportClient} />
      </Modal>
    </>
  );
}
