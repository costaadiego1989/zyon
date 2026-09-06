import type { RecoveryTemplates, RecoveryTemplatesUpdate, RecoveryTemplateStatus } from "../../api/endpoints/cart-recovery-templates.js";

export const TEMPLATE_STATUS_LABELS: Record<RecoveryTemplateStatus, string> = {
  waiting_connection: "Aguardando conexão do WhatsApp",
  draft: "Aguardando envio para análise",
  submitting: "Enviando para análise",
  submitted: "Em análise pela Meta",
  approved: "Aprovado pela Meta",
  rejected: "Não aprovado pela Meta",
  paused: "Pausado pela Meta",
  disabled: "Desativado pela Meta",
  submission_unknown: "Confirmando envio para análise",
};

export interface TemplatesEditorState {
  saved: RecoveryTemplates | null;
  draft: RecoveryTemplatesUpdate | null;
  conflict: boolean;
}

export const EMPTY_TEMPLATES_EDITOR: TemplatesEditorState = { saved: null, draft: null, conflict: false };

export function templateDraft(saved: RecoveryTemplates): RecoveryTemplatesUpdate {
  return { email: { ...saved.email }, whatsapp: { body: saved.whatsapp.body, revision: saved.whatsapp.revision } };
}

function sameContent(a: RecoveryTemplatesUpdate, b: RecoveryTemplatesUpdate): boolean {
  return a.email.subject === b.email.subject && a.email.body === b.email.body && a.whatsapp.body === b.whatsapp.body;
}

export function hasTemplateChanges(state: TemplatesEditorState): boolean {
  return !!state.saved && !!state.draft && !sameContent(state.draft, state.saved);
}

export function receiveTemplates(state: TemplatesEditorState, saved: RecoveryTemplates): TemplatesEditorState {
  if (!state.draft || !state.saved || !hasTemplateChanges(state) || sameContent(state.draft, saved)) {
    return { saved, draft: templateDraft(saved), conflict: false };
  }
  // Status polling may update approval without replacing text being edited.
  return { saved, draft: state.draft, conflict: state.conflict
    || state.draft.whatsapp.revision !== saved.whatsapp.revision
    || !sameContent(state.saved, saved) };
}

export function validateTemplates(draft: RecoveryTemplatesUpdate): string | null {
  if (!draft.email.subject.trim() || !draft.email.body.trim() || !draft.whatsapp.body.trim()) {
    return "Preencha o assunto e as duas mensagens.";
  }
  if (draft.email.subject.length > 150 || /[\r\n]/.test(draft.email.subject)) {
    return "O assunto deve ter até 150 caracteres, sem quebras de linha.";
  }
  if (draft.email.body.length > 10_000) return "A mensagem de e-mail deve ter até 10.000 caracteres.";
  if (draft.whatsapp.body.length > 1_024) return "A mensagem do WhatsApp deve ter até 1.024 caracteres.";
  for (const text of [draft.email.subject, draft.email.body, draft.whatsapp.body]) {
    const rest = text.replace(/\{\{(?:buyerName|storeName|link)\}\}/g, "");
    if (/[{}]/.test(rest)) return "Use somente {{buyerName}}, {{storeName}} e {{link}} como variáveis, com essa grafia.";
  }
  if (!draft.email.body.includes("{{link}}") || !draft.whatsapp.body.includes("{{link}}")) {
    return "Inclua {{link}} nas duas mensagens para o comprador retornar ao carrinho.";
  }
  return null;
}
