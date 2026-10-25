import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { ChannelPatch, OnboardingLease, WhatsAppOnboardingStore } from "../../domain/ports/whatsapp-onboarding.port.js";
import { PrismaWhatsAppConfigRepository } from "./prisma-whatsapp-config.repository.js";
import { encodeWhatsAppCredentials } from "./whatsapp-credential-codec.js";

@Injectable()
export class PrismaWhatsAppOnboardingStore implements WhatsAppOnboardingStore {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  // Short transaction lock only around DB operations. It serializes identity
  // reservations across tenants, without holding a connection during HTTP calls.
  private transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(734920106)`;
      return fn(tx);
    });
  }

  async claim(merchantId: string): Promise<OnboardingLease | null> {
    return this.transaction(async tx => {
      const row = await tx.whatsAppChannelConfig.upsert({
        where: { merchantId }, update: {},
        create: { merchantId, provider: "META_CLOUD", credentials: {}, enabled: false, status: "DISCONNECTED" },
      });
      const credentials = row.credentials as Record<string, any>;
      if (Number(credentials.onboardingLease?.expiresAt) > Date.now()) return null;
      const token = randomUUID();
      const updated = await tx.whatsAppChannelConfig.update({ where: { merchantId }, data: {
        credentials: { ...credentials, onboardingLease: { token, expiresAt: Date.now() + 120_000 } },
      } });
      return { token, config: new PrismaWhatsAppConfigRepository(this.prisma).mapToEntity(updated) };
    });
  }

  async save(lease: OnboardingLease, patch: ChannelPatch) {
    return this.transaction(async tx => {
      const merchantId = lease.config.merchantId;
      const row = await tx.whatsAppChannelConfig.findUniqueOrThrow({ where: { merchantId } });
      const credentials = row.credentials as Record<string, any>;
      if (credentials.onboardingLease?.token !== lease.token || credentials.onboardingLease.expiresAt <= Date.now()) {
        throw new ConflictException("whatsapp_onboarding_lease_lost");
      }
      const phone = patch.whatsappNumber ?? row.whatsappNumber;
      const wabaId = patch.credentials?.wabaId ?? credentials.wabaId;
      // Deliberately global boolean-only constraint check: the tenant extension
      // would rewrite a model findFirst to this merchant and miss other owners.
      // Values are bound parameters; no other tenant's data is returned.
      const digits = phone?.replace(/\D/g, "") || null;
      const waba = typeof wabaId === "string" && wabaId ? wabaId : null;
      const [identity] = await tx.$queryRaw<Array<{ taken: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM whatsapp_channel_configs WHERE merchant_id <> ${merchantId}
          AND (whatsapp_number = ${digits} OR whatsapp_number = ${digits ? `+${digits}` : null}
            OR credentials->>'wabaId' = ${waba})
        ) AS taken`;
      if (identity?.taken) {
        throw new ConflictException("whatsapp_identity_already_assigned");
      }
      const updated = await tx.whatsAppChannelConfig.update({ where: { merchantId }, data: {
        ...patch,
        // Renew only after fencing the current worker. A multi-step provider
        // flow can outlast the first lease while each individual call is bounded.
        credentials: encodeWhatsAppCredentials({ ...(patch.credentials ?? credentials),
          onboardingLease: { token: lease.token, expiresAt: Date.now() + 120_000 },
        }) as Prisma.InputJsonObject,
      } });
      lease.config = new PrismaWhatsAppConfigRepository(this.prisma).mapToEntity(updated);
      return lease.config;
    });
  }

  async release(lease: OnboardingLease) {
    await this.transaction(async tx => {
      const row = await tx.whatsAppChannelConfig.findUnique({ where: { merchantId: lease.config.merchantId } });
      const credentials = (row?.credentials ?? {}) as Record<string, any>;
      if (credentials.onboardingLease?.token !== lease.token) return;
      const { onboardingLease: _lease, ...rest } = credentials;
      await tx.whatsAppChannelConfig.update({ where: { merchantId: lease.config.merchantId }, data: { credentials: rest } });
    });
  }
}
