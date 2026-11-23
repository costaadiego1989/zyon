import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ProspectConversationService } from "../application/conversations/prospect-conversation.service.js";
import type { ZyonSalesAgentService } from "../application/knowledge/zyon-sales-agent.service.js";
import type { PrismaProspectConversationCommands } from "./conversations/prisma-prospect-conversation-commands.js";
import type { ProspectDispatchWorker } from "../application/campaigns/prospect-dispatch.worker.js";
import type { ProspectFollowUpWorker } from "../application/campaigns/prospect-follow-up.worker.js";
import { BILLING_PLANS } from "@zyon/shared-types";

export class ProspectEffectQueue {
  private initialCursor: string | undefined;
  private followCursor: string | undefined;
  constructor(
    private readonly db: PrismaClient,
    private readonly commands: PrismaProspectConversationCommands,
    private readonly agent: ZyonSalesAgentService,
    private readonly chat: ProspectConversationService,
    private readonly initial: ProspectDispatchWorker,
    private readonly follow: ProspectFollowUpWorker
  ) {}

  async replies(
    kind: "prospect.chat.dispatch" | "prospect.ai.reply",
    paid: boolean
  ) {
    const now = new Date();
    const due = {
      kind,
      availableAt: { lte: now },
      OR: [
        { state: "pending" },
        { state: "leased", leaseExpiresAt: { lte: now } },
      ],
    };
    const jobs = await this.db.prospectOutbox.findMany({
      where: due,
      orderBy: [{ availableAt: "asc" }, { id: "asc" }],
      take: 10,
    });
    for (const job of jobs) {
      const token = randomUUID();
      const claimed = await this.db.prospectOutbox.updateMany({
        where: { ...due, id: job.id },
        data: {
          state: "leased",
          leaseToken: token,
          leaseExpiresAt: new Date(Date.now() + 180000),
          attempts: { increment: 1 },
        },
      });
      if (!claimed.count) continue;
      const lease = { id: job.id, state: "leased", leaseToken: token };
      try {
        const payload = job.payload as {
          messageId: string;
          conversationId: string;
          controlEpoch: number;
        };
        if (kind === "prospect.chat.dispatch")
          await this.chat.dispatch(payload.messageId);
        else {
          const input = {
            messageId: payload.messageId,
            conversationId: payload.conversationId,
            expectedEpoch: payload.controlEpoch,
          };
          if (!paid) await this.commands.handoff(input, "model_disabled");
          else {
            const incoming = await this.db.prospectMessage.findFirst({
              where: {
                id: input.messageId,
                conversationId: input.conversationId,
                direction: "inbound",
              },
              select: { content: true },
            });
            const context = { text: incoming?.content ?? "" };
            if (context.text) {
              const campaign = await this.db.outreachAttempt.findFirst({
                where: {
                  ordinal: 0,
                  sequence: {
                    endpoint: {
                      conversations: { some: { id: input.conversationId } },
                    },
                  },
                },
                select: {
                  recipient: {
                    select: { campaign: { select: { offerSnapshot: true,setupVersion:true,offerPolicy:true } } },
                  },
                },
              });
              const offer = campaign?.recipient?.campaign.offerSnapshot as {
                planKey?: string;
              } | null;
              const policy=campaign?.recipient?.campaign.offerPolicy as {mode?:string}|null;
              const catalogMode=campaign?.recipient?.campaign.setupVersion===2&&policy?.mode==="catalog";
              const words=context.text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u);
              const mentioned=Object.keys(BILLING_PLANS).filter(key=>words.includes(key));
              const planKey=catalogMode?undefined:mentioned.length===1?mentioned[0]:offer?.planKey;
              if (!planKey&&!catalogMode)
                await this.commands.handoff(input, "offer_unavailable");
              else {
                const question = context.text.trim().slice(0, 180);
                const query = /integr/i.test(question)
                  ? {
                      operation: "integration_capability" as const,
                      params: { integration: question },
                    }
                  : /plano|preço|contratar|assinar/i.test(question)
                  ? {
                      operation: "compare_plans" as const,
                      params: { planKeys: planKey?[planKey]:Object.keys(BILLING_PLANS) },
                    }
                  : /como|recurso|funciona/i.test(question)
                  ? {
                      operation: "explain_feature" as const,
                      params: { feature: question },
                    }
                  : { operation: "answer_faq" as const, params: { question } };
                await this.agent.respond({ ...input, planKey, query });
              }
            }
          }
        }
        await this.db.prospectOutbox.updateMany({
          where: lease,
          data: {
            state: "completed",
            leaseToken: null,
            leaseExpiresAt: null,
            errorCode: null,
          },
        });
      } catch (error) {
        const code =
          error instanceof Error && /^[a-z_]{1,80}$/.test(error.message)
            ? error.message
            : "worker_unavailable";
        await this.db.prospectOutbox.updateMany({
          where: lease,
          data: {
            state: "pending",
            availableAt: new Date(Date.now() + 30000),
            errorCode: code,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
      }
    }
  }
  async sends() {
    const candidates = await this.db.campaignRecipient.findMany({
      where: {
        state: { in: ["pending", "reserved", "blocked"] },
        campaign: { state: "running" },
        ...(this.initialCursor ? { id: { gt: this.initialCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 25,
      select: { id: true },
    });
    for (const item of candidates)
      await this.initial.processRecipient(item.id, 0);
    this.initialCursor =
      candidates.length === 25
        ? candidates[candidates.length - 1].id
        : undefined;
    this.followCursor =
      (await this.follow.poll(this.followCursor, 25)).nextCursor ?? undefined;
    await this.replies("prospect.chat.dispatch", false);
  }
}
