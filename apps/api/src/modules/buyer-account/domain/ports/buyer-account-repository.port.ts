import type { BuyerAccount } from "../entities/buyer-account.entity.js";
import type { BuyerAgentProfile } from "../entities/buyer-agent-profile.entity.js";

export interface BuyerAccountRepository {
  save(account: BuyerAccount): Promise<void>;
  findByEmail(email: string): Promise<BuyerAccount | null>;
  findByPhone(phone: string): Promise<BuyerAccount | null>;
  /** Bounded phone lookup for an independently authenticated WhatsApp sender. */
  findRegisteredByPhones?(phones: string[], emailHint?: string): Promise<BuyerAccount[]>;
  findByGlobalUserId(globalUserId: string): Promise<BuyerAccount | null>;
  findAgentByGlobalUserId(globalUserId: string): Promise<BuyerAgentProfile | null>;
  saveAgent(agent: BuyerAgentProfile): Promise<void>;
  findM2mByTokenHash(tokenHash: string): Promise<BuyerAgentProfile | null>;
}

export const BUYER_ACCOUNT_REPOSITORY = Symbol("BUYER_ACCOUNT_REPOSITORY");
