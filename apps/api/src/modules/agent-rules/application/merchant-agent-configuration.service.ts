import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { findMerchantAgentRule } from "../infrastructure/find-merchant-agent-rule.js";
import { PrismaAgentRulesRepository } from "../infrastructure/prisma-agent-rules.repository.js";
import { PrismaCheckoutSettingsRepository } from "../../checkout-settings/infrastructure/prisma-checkout-settings.repository.js";
import { PrismaMerchantRepository } from "../../merchant/infrastructure/prisma-merchant.repository.js";
import { GetAgentRulesUseCase, UpdateAgentRulesUseCase } from "./agent-rules.use-cases.js";
import { CheckoutSettingsEntity } from "../../checkout-settings/domain/entities/checkout-settings.entity.js";
import type { AgentRulesPatch } from "../domain/agent-rules.types.js";
import type { StageQuickReplies } from "@zyon/shared-types";

export interface MerchantAgentConfigurationPatch {
  identity: NonNullable<AgentRulesPatch["identity"]>;
  mode: "proactive" | "manual_only" | "silent_until_trigger";
  quickReplies: Record<string, string[]>;
  revision?: string;
}

@Injectable()
export class MerchantAgentConfigurationService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  private async snapshot(db: PrismaClient, merchantId: string) {
    if (!await db.merchant.findUnique({ where: { id: merchantId }, select: { id: true } })) throw new NotFoundException("merchant_not_found");
    const [agent, checkout, rules, persistedAgent] = await Promise.all([
      new GetAgentRulesUseCase(new PrismaAgentRulesRepository(db)).execute({ merchantId }),
      new PrismaCheckoutSettingsRepository(db).get(merchantId),
      db.merchantRule.findUnique({ where: { merchantId } }),
      findMerchantAgentRule(db, merchantId),
    ]);
    return {
      identity: agent.identity,
      mode: checkout?.mode ?? "silent_until_trigger",
      quickReplies: rules?.quickReplies ?? {},
      // Default agent snapshots have a new timestamp on each read; only persisted revisions count.
      revision: JSON.stringify([
        persistedAgent?.updatedAt.toISOString() ?? null,
        checkout?.updatedAt ?? null,
        rules?.updatedAt.toISOString() ?? null,
      ]),
    };
  }

  get(merchantId: string) {
    return this.prisma.$transaction(tx => this.snapshot(tx as PrismaClient, merchantId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async update(merchantId: string, patch: MerchantAgentConfigurationPatch) {
    if (!patch || !["proactive", "manual_only", "silent_until_trigger"].includes(patch.mode)) throw new BadRequestException("invalid_agent_mode");
    const replies = patch.quickReplies;
    if (!replies || typeof replies !== "object" || Array.isArray(replies) || Object.keys(replies).length > 50 || Object.entries(replies).some(([stage, values]) => !/^[a-z_]{1,40}$/.test(stage) || !Array.isArray(values) || values.length > 20 || values.some(v => typeof v !== "string" || !v.trim() || v.length > 100))) throw new BadRequestException("invalid_quick_replies");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const db = tx as PrismaClient;
          const before = await this.snapshot(db, merchantId);
          if (patch.revision !== undefined && patch.revision !== before.revision) throw new ConflictException("agent_configuration_changed");
          await new UpdateAgentRulesUseCase(new PrismaAgentRulesRepository(db)).execute({ merchantId }, { identity: patch.identity, checkoutSettings: { agentMode: patch.mode } });
          const checkoutRepo = new PrismaCheckoutSettingsRepository(db);
          const current = await checkoutRepo.get(merchantId) ?? CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
          await checkoutRepo.save(CheckoutSettingsEntity.rehydrate(current).update({ mode: patch.mode }).snapshot());
          await new PrismaMerchantRepository(db).updateRules(merchantId, { quickReplies: replies as StageQuickReplies });
          return this.snapshot(db, merchantId);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if ((error as { code?: string }).code === "P2034" && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException("agent_configuration_changed");
  }
}
