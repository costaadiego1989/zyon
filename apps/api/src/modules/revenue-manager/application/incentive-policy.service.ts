import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { incentiveKey } from "../domain/incentive-budget.js";
import { assertIncentivePolicyLimits, incentivePolicySnapshot, type IncentivePolicyLimits } from "../domain/incentive-policy.js";
import { readIncentivePolicy } from "../infrastructure/incentive-policy.reader.js";

export type IncentivePolicyCommand = IncentivePolicyLimits & { expectedVersion: number; requestKey: string };

@Injectable()
export class IncentivePolicyService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  read(merchantId: string) { return this.prisma.$transaction(tx => readIncentivePolicy(tx, merchantId)); }

  async save(merchantId: string, actorId: string, input: IncentivePolicyCommand) {
    input = structuredClone(input);
    try { assertIncentivePolicyLimits(input); } catch { throw new BadRequestException("INCENTIVE_POLICY_INVALID_LIMITS"); }
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= 2_147_483_647
      || !incentiveKey(input.requestKey) || typeof actorId !== "string" || !actorId.trim() || actorId.length > 150) {
      throw new BadRequestException("INCENTIVE_POLICY_INVALID_COMMAND");
    }
    const requestHash = digest({ actorId, ...input });
    return this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM merchants WHERE id = ${merchantId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException("INCENTIVE_POLICY_STORE_NOT_FOUND");
      const previous = await tx.merchantIncentivePolicy.findUnique({ where: { merchantId_requestKey: { merchantId, requestKey: input.requestKey } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException("INCENTIVE_POLICY_REQUEST_CONFLICT");
        return incentivePolicySnapshot(merchantId, previous.version, previous);
      }
      const current = await readIncentivePolicy(tx, merchantId);
      if (current.version !== input.expectedVersion) throw new ConflictException("INCENTIVE_POLICY_VERSION_CONFLICT");
      const next = incentivePolicySnapshot(merchantId, current.version + 1, input);
      await tx.merchantIncentivePolicy.create({ data: { merchantId, version: next.version, actorId,
        requestKey: input.requestKey, requestHash, policyHash: next.policyHash, enabled: next.enabled,
        limitCents: next.limitCents, maxDiscountCents: next.maxDiscountCents, maxRedemptions: next.maxRedemptions } });
      return next;
    });
  }
}
