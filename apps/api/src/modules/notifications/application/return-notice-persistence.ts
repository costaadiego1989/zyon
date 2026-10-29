import type { Prisma } from "@prisma/client";
import type { ReturnNoticeType, ReturnNoticePayload } from "../domain/return-notice.js";

/** Called only inside the transaction that persists the visible decision. */
export async function enqueueReturnNotice(tx: Prisma.TransactionClient, input: {
  merchantId: string; ticketId: string; messageId: string; type: ReturnNoticeType; explanation: string;
  ret: { id: string; orderId: string; kind: string; orderSnapshot: unknown; items: Array<{ variantId: string; quantity: number }> };
}) {
  const snapshot = input.ret.orderSnapshot as { items?: Array<{ variantId?: string; sku?: string; name?: string }> } | null;
  const payload: ReturnNoticePayload = {
    orderId: input.ret.orderId, kind: input.ret.kind, explanation: input.explanation,
    items: input.ret.items.map(item => ({ quantity: item.quantity,
      name: snapshot?.items?.find(line => line.variantId === item.variantId || line.sku === item.variantId)?.name
        ?? (item.variantId === "all" ? "Itens do pedido" : item.variantId) })),
  };
  await tx.returnNoticeDelivery.createMany({ skipDuplicates: true,
    data: ["email", "whatsapp"].map(channel => ({
      merchantId: input.merchantId, returnId: input.ret.id, ticketId: input.ticketId, messageId: input.messageId,
      type: input.type, channel, payload: payload as unknown as Prisma.InputJsonValue,
    })),
  });
}
