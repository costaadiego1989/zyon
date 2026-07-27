import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { CustomerAddress } from "@zyon/shared-types";
import {
  decryptPii,
  encryptPii,
  isPiiEncrypted,
} from "../../../shared/crypto/pii-cipher.service.js";
import { BuyerAccount } from "../domain/entities/buyer-account.entity.js";
import { BuyerAgentProfile, type AgentPersonality } from "../domain/entities/buyer-agent-profile.entity.js";
import type { BuyerAccountRepository } from "../domain/ports/buyer-account-repository.port.js";

export class PrismaBuyerAccountRepository implements BuyerAccountRepository {
  private readonly logger = new Logger(PrismaBuyerAccountRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async save(account: BuyerAccount): Promise<void> {
    const pii = encryptedBuyerPii(account);
    await (this.prisma as any).buyerAccount.upsert({
      where: { globalUserId: account.globalUserId },
      create: {
        globalUserId: account.globalUserId,
        email: account.email,
        passwordHash: account.passwordHash,
        displayName: account.displayName,
        phone: pii.phone,
        cpf: pii.cpf,
        address: account.address ?? null,
      },
      update: {
        email: account.email,
        passwordHash: account.passwordHash,
        displayName: account.displayName,
        phone: pii.phone,
        cpf: pii.cpf,
        address: account.address ?? null,
        updatedAt: account.updatedAt,
      },
    });
  }

  async findByEmail(email: string): Promise<BuyerAccount | null> {
    const row = await (this.prisma as any).buyerAccount.findUnique({ where: { email } });
    return row ? toDomainAccount(row) : null;
  }

  async findByPhone(phone: string): Promise<BuyerAccount | null> {
    this.logger.warn("buyer_account_phone_lookup_requires_hash_index_migration");
    const row = await (this.prisma as any).buyerAccount.findFirst({ where: { phone: phone.replace(/\D/g, "") } });
    return row ? toDomainAccount(row) : null;
  }

  async findByGlobalUserId(globalUserId: string): Promise<BuyerAccount | null> {
    const row = await (this.prisma as any).buyerAccount.findUnique({ where: { globalUserId } });
    return row ? toDomainAccount(row) : null;
  }

  async findAgentByGlobalUserId(globalUserId: string): Promise<BuyerAgentProfile | null> {
    const row = await this.prisma.buyerAgentProfile.findUnique({ where: { globalUserId } });
    return row ? toDomainAgent(row) : null;
  }

  async saveAgent(agent: BuyerAgentProfile): Promise<void> {
    await this.prisma.buyerAgentProfile.upsert({
      where: { globalUserId: agent.globalUserId },
      create: {
        id: agent.id,
        globalUserId: agent.globalUserId,
        name: agent.name,
        personality: agent.personality,
        maxRounds: agent.maxRounds,
        targetDiscountPercent: agent.targetDiscountPercent,
        minimumAcceptableDiscountPercent: agent.minimumAcceptableDiscountPercent,
        autoAcceptThreshold: agent.autoAcceptThreshold ?? null,
        m2mEnabled: agent.m2mEnabled,
        m2mTokenHash: agent.m2mTokenHash ?? null,
        m2mTokenCreatedAt: agent.m2mTokenCreatedAt ?? null,
      },
      update: {
        name: agent.name,
        personality: agent.personality,
        maxRounds: agent.maxRounds,
        targetDiscountPercent: agent.targetDiscountPercent,
        minimumAcceptableDiscountPercent: agent.minimumAcceptableDiscountPercent,
        autoAcceptThreshold: agent.autoAcceptThreshold ?? null,
        m2mEnabled: agent.m2mEnabled,
        m2mTokenHash: agent.m2mTokenHash ?? null,
        m2mTokenCreatedAt: agent.m2mTokenCreatedAt ?? null,
        updatedAt: agent.updatedAt,
      },
    });
  }

  async findM2mByTokenHash(tokenHash: string): Promise<BuyerAgentProfile | null> {
    const row = await this.prisma.buyerAgentProfile.findFirst({ where: { m2mTokenHash: tokenHash } });
    return row ? toDomainAgent(row) : null;
  }
}

type BuyerPiiFields = Pick<BuyerAccount, "phone" | "cpf">;

type AccountRow = {
  globalUserId: string;
  email: string;
  passwordHash: string;
  displayName: string;
  phone: string | null;
  cpf: string | null;
  address?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type AgentRow = {
  id: string;
  globalUserId: string;
  name: string;
  personality: string;
  maxRounds: number;
  targetDiscountPercent: number;
  minimumAcceptableDiscountPercent: number;
  autoAcceptThreshold: number | null;
  m2mEnabled: boolean;
  m2mTokenHash: string | null;
  m2mTokenCreatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function encryptedBuyerPii(account: BuyerPiiFields): { phone: string | null; cpf: string | null } {
  return {
    phone: piiForStorage(account.phone),
    cpf: piiForStorage(account.cpf),
  };
}

function piiForStorage(value?: string): string | null {
  if (!value) return null;
  return isPiiEncrypted(value) ? value : encryptPii(value);
}

function piiForDomain(value: string | null): string | undefined {
  if (!value) return undefined;
  return isPiiEncrypted(value) ? decryptPii(value) : value;
}

function toDomainAccount(row: AccountRow): BuyerAccount {
  return new BuyerAccount({
    globalUserId: row.globalUserId,
    email: row.email,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    phone: piiForDomain(row.phone),
    cpf: piiForDomain(row.cpf),
    address: toCustomerAddress(row.address),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toCustomerAddress(value: unknown): CustomerAddress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const address: CustomerAddress = {};
  for (const key of ["zip", "street", "number", "complement", "neighborhood", "city", "state"] as const) {
    if (typeof source[key] === "string") address[key] = source[key] as string;
  }
  return Object.keys(address).length > 0 ? address : undefined;
}

function toDomainAgent(row: AgentRow): BuyerAgentProfile {
  return new BuyerAgentProfile({
    id: row.id,
    globalUserId: row.globalUserId,
    name: row.name,
    personality: row.personality as AgentPersonality,
    maxRounds: row.maxRounds,
    targetDiscountPercent: row.targetDiscountPercent,
    minimumAcceptableDiscountPercent: row.minimumAcceptableDiscountPercent,
    autoAcceptThreshold: row.autoAcceptThreshold ?? undefined,
    m2mEnabled: row.m2mEnabled,
    m2mTokenHash: row.m2mTokenHash ?? undefined,
    m2mTokenCreatedAt: row.m2mTokenCreatedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
