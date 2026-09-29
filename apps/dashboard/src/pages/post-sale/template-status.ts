export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  approved: "Aprovado pela Meta",
  submitted: "Em análise pela Meta",
  submitting: "Enviando para análise",
  rejected: "Não aprovado pela Meta",
  paused: "Pausado pela Meta",
  disabled: "Desativado pela Meta",
  draft: "Aguardando envio para análise",
  waiting_connection: "Aguardando conexão",
  submission_unknown: "Confirmando envio para análise",
};

export function messageStatusLabel(status?: string | null) {
  return status ? MESSAGE_STATUS_LABELS[status] ?? "Estado indisponível" : "Sem modelo configurado";
}
