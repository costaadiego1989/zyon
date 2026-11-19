import { DashboardHttpError } from "../../api/http/error.js";
import type { ConversationApi, ConversationContext } from "./conversation-types.js";

/** A denied private profile may still be an authenticated Staff support actor.
 * The server context supplies identity; this never fabricates a merchant profile. */
export async function resolveStaffConversationContext(
  profileError: unknown,
  api: Pick<ConversationApi, "getWhatsAppConversationContext">,
): Promise<ConversationContext | null> {
  if (!(profileError instanceof DashboardHttpError) || profileError.status !== 403) return null;
  try {
    const context = await api.getWhatsAppConversationContext();
    if (context?.role !== "STAFF" || typeof context.merchant_id !== "string" || !context.merchant_id.trim()
      || typeof context.user_id !== "string" || !context.user_id.trim()) return null;
    return { merchant_id: context.merchant_id, user_id: context.user_id, role: "STAFF" };
  } catch { return null; }
}
