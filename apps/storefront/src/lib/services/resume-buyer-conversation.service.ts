import { getValidBuyer } from "@/lib/buyer-auth";
import { conversationAccessMatchesCurrentOrigin, ensureConversationAccess } from "@/lib/conversation-access";
import { fetchConversation } from "./buyer-hub.service";
import type { BuyerConversation } from "@/lib/viewmodels/useBuyerHub/types";

/** Revalidate history ownership and completion before returning to an already-open thread. */
export async function validateCurrentBuyerConversation(conversation: BuyerConversation, merchantId: string, currentSessionId: string): Promise<void> {
  const token = getValidBuyer()?.token;
  if (!token || conversation.merchant_id !== merchantId || conversation.session_id !== currentSessionId
    || !conversationAccessMatchesCurrentOrigin(currentSessionId)) throw new Error("conversation_not_available");
  const fresh = await fetchConversation(conversation.id, merchantId);
  if (fresh.id !== conversation.id || fresh.merchant_id !== merchantId || fresh.session_id !== currentSessionId
    || !["in_progress", "history"].includes(fresh.status ?? "")) throw new Error("conversation_not_available");
  await ensureConversationAccess(currentSessionId);
  if (getValidBuyer()?.token !== token) throw new Error("buyer_session_changed");
}
