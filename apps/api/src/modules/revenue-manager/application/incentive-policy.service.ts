import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { digest } from "../../experiments/domain/services/measurement-plan.js";
import { incentiveKey } from "../domain/incentive-budget.js";
import { assertIncentivePolicyLimits, incentivePolicySnapshot, type IncentivePolicyLimits, type IncentivePolicyMode } from "../domain/incentive-policy.js";
import { readIncentivePolicy, readIncentivePolicyState } from "../infrastructure/incentive-policy.reader.js";

export type IncentivePolicyCommand = Partial<IncentivePolicyLimits> & { mode?: IncentivePolicyMode; expectedVersion: number; requestKey: string };

@Injectable()
export class IncentivePolicyService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  read(merchantId: string) { return this.prisma.$transaction(async tx => {
    const state = await readIncentivePolicyState(tx, merchantId); return { ...state.snapshot, mode: state.mode };
  }); }

  async save(merchantId: string, actorId: string, input: IncentivePolicyCommand) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("INCENTIVE_POLICY_INVALID_COMMAND");
    input = structuredClone(input);
    const mode = input.mode ?? (input.enabled === false ? "disabled" : "manual");
    if (!["automatic", "manual", "disabled"].includes(mode)
      || Object.keys(input).some(k => !["mode", "expectedVersion", "requestKey", "enabled", "limitCents", "maxDiscountCents", "maxRedemptions"].includes(k))) {
      throw new BadRequestException("INCENTIVE_POLICY_INVALID_COMMAND");
    }
    let limits: IncentivePolicyLimits;
    if (mode === "automatic") {
      if (input.enabled === true || [input.limitCents, input.maxDiscountCents, input.maxRedemptions].some(n => n !== undefined && n !== 0)) {
        throw new BadRequestException("INCENTIVE_POLICY_INVALID_LIMITS");
      }
      limits = { enabled: false, limitCents: 0, maxDiscountCents: 0, maxRedemptions: 0 };
    } else limits = { enabled: mode === "manual", limitCents: input.limitCents ?? 0,
      maxDiscountCents: input.maxDiscountCents ?? 0, maxRedemptions: input.maxRedemptions ?? 0 };
    if ((mode === "manual" && input.enabled === false) || (mode === "disabled" && input.enabled === true)) throw new BadRequestException("INCENTIVE_POLICY_INVALID_LIMITS");
    try { assertIncentivePolicyLimits(limits); } catch { throw new BadRequestException("INCENTIVE_POLICY_INVALID_LIMITS"); }
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
        const saved = incentivePolicySnapshot(merchantId, previous.version, previous);
        return input.mode ? { ...saved, mode: previous.origin === "automatic" ? "automatic" as const
          : previous.enabled ? "manual" as const : "disabled" as const } : saved;
      }
      const current = await readIncentivePolicy(tx, merchantId);
      if (current.version !== input.expectedVersion) throw new ConflictException("INCENTIVE_POLICY_VERSION_CONFLICT");
      const next = incentivePolicySnapshot(merchantId, current.version + 1, limits);
      await tx.merchantIncentivePolicy.create({ data: { merchantId, version: next.version, actorId,
        requestKey: input.requestKey, requestHash, policyHash: next.policyHash, enabled: next.enabled, origin: mode === "automatic" ? "automatic" : "manual",
        limitCents: next.limitCents, maxDiscountCents: next.maxDiscountCents, maxRedemptions: next.maxRedemptions } });
      return input.mode ? { ...next, mode } : next;
    });
  }
}
