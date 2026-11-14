import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient, ServiceBusinessPolicy } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { ServiceBusinessPolicyError, validateServicePolicyConfiguration } from "../domain/service-business-policy.js";

export function parseServicePolicyUpdate(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("service_policy_required");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["expectedVersion", "holdEnabled", "holdMinutes", "paymentMode", "admissionsEnabled"].includes(key)))
    throw new BadRequestException("invalid_service_policy_field");
  if (typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0 || body.expectedVersion >= 2_147_483_647)
    throw new BadRequestException("service_policy_expected_version_required");
  if (body.admissionsEnabled !== undefined && typeof body.admissionsEnabled !== "boolean")
    throw new BadRequestException("service_policy_invalid_admissions");
  try {
    return { ...validateServicePolicyConfiguration(body), expectedVersion: body.expectedVersion, admissionsEnabled: body.admissionsEnabled === true };
  } catch (error) {
    if (error instanceof ServiceBusinessPolicyError) throw new BadRequestException(error.code);
    throw error;
  }
}

export async function assertConfigurableServiceBusiness(tx: Pick<Prisma.TransactionClient, "merchant">, merchantId: string) {
  const merchant = await tx.merchant.findUnique({ where: { id: merchantId }, select: {
    businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true,
  } });
  if (!merchant) throw new NotFoundException("merchant_not_found");
  if (merchant.businessMode !== "services") throw new ForbiddenException("services_mode_required");
  if (merchant.businessModeNeedsReview || !merchant.businessModeSelectedAt) throw new ForbiddenException("business_classification_required");
}

function presentPolicy(row: ServiceBusinessPolicy | null) {
  if (!row?.configuredAt) return { status: "unconfigured", version: row?.version ?? 0, policy: null };
  try {
    return { status: "configured", version: row.version, policy: {
      ...validateServicePolicyConfiguration(row), admissionsEnabled: row.admissionsEnabled,
    } };
  } catch (error) {
    if (error instanceof ServiceBusinessPolicyError) return { status: "invalid", version: row.version, policy: null };
    throw error;
  }
}

@Injectable()
export class ConfigureServiceBusinessPolicyUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async read(merchantId: string) {
    await assertConfigurableServiceBusiness(this.prisma, merchantId);
    return presentPolicy(await this.prisma.serviceBusinessPolicy.findUnique({ where: { merchantId } }));
  }

  async execute(merchantId: string, actorId: string, input: unknown) {
    const { expectedVersion, ...configuration } = parseServicePolicyUpdate(input);
    return this.prisma.$transaction(async tx => {
      // Catalog, policy and mode writers share this merchant-first lock order.
      await tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      await assertConfigurableServiceBusiness(tx, merchantId);
      const current = await tx.serviceBusinessPolicy.findUnique({ where: { merchantId } });
      if ((current?.version ?? 0) !== expectedVersion) throw new ConflictException("service_policy_version_conflict");
      const data = { ...configuration, version: expectedVersion + 1, configuredAt: new Date() };
      const saved = await tx.serviceBusinessPolicy.upsert({ where: { merchantId }, create: { merchantId, ...data }, update: data });
      await tx.merchantAuditEvent.create({ data: {
        merchantId, actorType: "human", actorId, action: "service_policy.updated", resourceType: "service_business_policy", resourceId: merchantId,
        metadata: { previousVersion: expectedVersion, version: saved.version, ...configuration },
      } });
      return presentPolicy(saved);
    });
  }
}
