import { dashboardJson } from "../../api/http/client.js";

export interface RecoveryTestFeedback {
  type: "success" | "error";
  text: string;
}

/** An HTTP success alone does not establish provider acceptance. */
export function recoveryTestFeedback(value: unknown): RecoveryTestFeedback {
  const result = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const channel = result.channel === "whatsapp_template" ? "WhatsApp"
    : result.channel === "email" ? "e-mail" : null;

  if (result.sent === true && result.status === "sent" && channel
    && typeof result.messageId === "string" && result.messageId.trim()) {
    return { type: "success", text: `Teste aceito para envio por ${channel}.` };
  }
  if (result.status === "skipped") {
    return {
      type: "error",
      text: "Teste não enviado: nenhum canal disponível. Informe um e-mail ou conecte o WhatsApp da loja com um modelo ativo e aprovado.",
    };
  }
  if (result.status === "failed") {
    return { type: "error", text: `Falha no teste${channel ? ` por ${channel}` : ""}. Verifique a conexão e o destinatário.` };
  }
  return {
    type: "error",
    text: `Envio${channel ? ` por ${channel}` : ""} não confirmado. Confira o recebimento antes de repetir o teste.`,
  };
}

export async function sendRecoveryTest(
  apiBaseUrl: string,
  recipients: { phone?: string; email?: string },
  fetchImpl?: typeof fetch,
): Promise<RecoveryTestFeedback> {
  const phone = recipients.phone?.trim() || undefined;
  const email = recipients.email?.trim() || undefined;
  if (!phone && !email) {
    return { type: "error", text: "Informe um telefone ou e-mail para testar o envio." };
  }
  const result = await dashboardJson<unknown>(apiBaseUrl, "/cart-recovery/test-send", {
    method: "POST",
    jsonBody: { phone, email },
  }, fetchImpl);
  return recoveryTestFeedback(result);
}
