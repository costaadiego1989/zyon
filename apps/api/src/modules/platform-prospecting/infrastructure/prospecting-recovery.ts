import type { PrismaClient } from "@prisma/client";
import type { PrismaCampaignRepository } from "./campaigns/prisma-campaign.repository.js";
import type { PrismaProspectConversationCommands } from "./conversations/prisma-prospect-conversation-commands.js";

/** A worker may disappear after the provider accepted its packet and before committing its result. */
export async function recoverProspectSubmissions(
  db: PrismaClient,
  campaigns: PrismaCampaignRepository,
  conversations: PrismaProspectConversationCommands,
  now = new Date()
) {
  const uncertain = { state: "outcome_unknown", errorCode: "submission_interrupted" } as const;
  const attempts = await db.outreachAttempt.findMany({
    where: { state: "submitting", leaseExpiresAt: {lte:now}, leaseToken: {not:null} },
    orderBy: {id:"asc"}, take:25, select:{id:true,leaseToken:true},
  });
  for (const attempt of attempts)
    await campaigns.recordResult(attempt.id, attempt.leaseToken!, uncertain);

  // Chat dispatch holds its outbox at the submission boundary. Allow its full worker lease to finish.
  const messages = await db.prospectMessage.findMany({
    where:{direction:"outbound",attemptId:null,state:"submitting",submittedAt:{lte:new Date(now.getTime()-180_000)}},
    orderBy:{id:"asc"},take:25,select:{id:true,senderBindingId:true},
  });
  for (const message of messages)
    await conversations.settleReply(message.id,{id:message.senderBindingId},uncertain);
}
