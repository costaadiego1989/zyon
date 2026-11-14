import { createHash, randomUUID } from "node:crypto";
import type { CheckoutSession, CashbackCheckoutQuote } from "@zyon/shared-types";

type CashbackCommand = { kind: "balance" } | { kind: "remove" } | { kind: "choose" } | { kind: "apply"; amountCents: number };
export interface CashbackChannelOperations {
  quoteCheckout(session: CheckoutSession): Promise<CashbackCheckoutQuote>;
  reserveCheckout(session: CheckoutSession, amountCents: number, commandKey: string): Promise<CashbackCheckoutQuote>;
  releaseReservation(session: CheckoutSession, commandKey?: string): Promise<CashbackCheckoutQuote>;
}

export function parseCashbackCommand(message: string): CashbackCommand | null {
  let text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[!?]+$/, "").trim();
  text = text.replace(/^(?:por favor[,\s]+|(?:eu )?(?:quero|desejo)\s+|(?:voce )?(?:pode|poderia)\s+)/, "");
  if (/^(?:remover|remova|retirar|retire|cancelar|cancele|nao usar) (?:o |meu )?cashback$/.test(text)) return { kind: "remove" };
  if (/^(?:cashback|(?:meu )?saldo de cashback|(?:consultar|ver|mostrar) (?:o |meu )?(?:saldo de )?cashback|qual (?:e )?(?:o )?(?:meu )?saldo de cashback|quanto (?:eu )?tenho (?:de|em) cashback)$/.test(text)) return { kind: "balance" };
  if (/^(?:usar|use|utilizar|utilize|aplicar|aplique) (?:o |meu )?cashback$/.test(text)) return { kind: "choose" };
  const match = text.match(/^(?:usar|use|utilizar|utilize|aplicar|aplique) (?:r\$\s*)?(\d{1,8}(?:[.,]\d{1,2})?|\d{1,3}(?:\.\d{3}){1,2},\d{2}) (?:de )?cashback$/);
  if (!match) return null;
  const number = match[1]!.includes(",") && match[1]!.includes(".") ? match[1]!.replace(/\./g, "") : match[1]!;
  const [units, fraction = ""] = number.replace(".", ",").split(",");
  const amountCents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 2_147_483_647 ? { kind: "apply", amountCents } : null;
}

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const applyLabel = (cents: number) => `Usar ${brl(cents)} de cashback`;

/** Only the current inbound command authorizes a write; no model-supplied confirmation. */
export async function respondToCashbackCommand(
  operations: CashbackChannelOperations,
  session: CheckoutSession,
  message: string,
  requestId?: string,
): Promise<{ agentMessage: string; quickReplies: string[] } | null> {
  const command = parseCashbackCommand(message);
  if (!command) return null;
  try {
    if (command.kind === "remove") {
      const commandKey = "wa-remove:" + createHash("sha256").update(JSON.stringify([
        session.merchantId, session.sessionId, session.globalUserId, requestId ?? randomUUID(),
      ])).digest("hex");
      const removed = await operations.releaseReservation(session, commandKey);
      if (removed.reservedCents !== 0) throw new Error("cashback_remove_not_confirmed");
      return { agentMessage: "Cashback removido deste pedido. O crédito válido voltou a ficar disponível para novas compras nesta loja.", quickReplies: ["Meu saldo de cashback"] };
    }
    const quote = await operations.quoteCheckout(session);
    if (["buyer_identity_required", "cashback_verified_identity_required"].includes(quote.reason ?? "")) {
      return { agentMessage: "Vincule seu WhatsApp na sua conta da loja para consultar e usar o mesmo saldo nos dois canais.", quickReplies: [] };
    }
    if (command.kind === "balance") {
      const reserved = quote.reservedCents > 0 ? ` Há ${brl(quote.reservedCents)} reservados neste pedido.` : "";
      return { agentMessage: `Seu saldo disponível de cashback nesta loja é ${brl(quote.availableCents)}.${reserved}`,
        quickReplies: quote.eligible && quote.maximumRedeemCents > 0 ? [applyLabel(quote.maximumRedeemCents)] : [] };
    }
    if (!quote.eligible || quote.maximumRedeemCents <= 0) {
      const message = quote.reason === "buyer_identity_required"
        ? "Confirme sua identidade para consultar e utilizar cashback nesta loja."
        : "Não há cashback disponível para aplicar neste pedido com as condições atuais. Você pode consultar seu saldo e as regras da loja.";
      return { agentMessage: message, quickReplies: ["Meu saldo de cashback"] };
    }
    if (command.kind === "choose") {
      return { agentMessage: `Você pode usar até ${brl(quote.maximumRedeemCents)} de cashback neste pedido. Confirme o valor antes de continuar.`, quickReplies: [applyLabel(quote.maximumRedeemCents)] };
    }
    if (command.amountCents > quote.maximumRedeemCents) {
      return { agentMessage: `O máximo disponível para este pedido é ${brl(quote.maximumRedeemCents)}. Confirme se deseja usar esse valor.`, quickReplies: [applyLabel(quote.maximumRedeemCents)] };
    }
    const commandKey = "wa-cashback:" + createHash("sha256").update(JSON.stringify([
      session.merchantId, session.sessionId, session.globalUserId, quote.fingerprint,
      command.amountCents, requestId ?? message,
    ])).digest("hex");
    const applied = await operations.reserveCheckout(session, command.amountCents, commandKey);
    if (applied.reservedCents !== command.amountCents) throw new Error("cashback_reservation_not_confirmed");
    return { agentMessage: `${brl(applied.reservedCents)} de cashback aplicados a este pedido. O valor será descontado dos produtos; frete e taxas permanecem separados.`, quickReplies: ["Remover cashback", "Meu saldo de cashback"] };
  } catch {
    return { agentMessage: "Não consegui confirmar a operação de cashback. Consulte o saldo antes de tentar novamente ou peça ajuda à loja.", quickReplies: ["Meu saldo de cashback"] };
  }
}
