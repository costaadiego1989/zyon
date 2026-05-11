import { Injectable } from "@nestjs/common";
import type { BuyerAccount } from "../domain/entities/buyer-account.entity.js";
import type { BuyerAgentProfile } from "../domain/entities/buyer-agent-profile.entity.js";
import type { BuyerAccountRepository } from "../domain/ports/buyer-account-repository.port.js";

@Injectable()
export class InMemoryBuyerAccountRepository implements BuyerAccountRepository {
  private readonly accounts = new Map<string, BuyerAccount>();
  private readonly agents = new Map<string, BuyerAgentProfile>();

  async save(account: BuyerAccount): Promise<void> {
    this.accounts.set(account.globalUserId, account);
  }

  async findByEmail(email: string): Promise<BuyerAccount | null> {
    for (const account of this.accounts.values()) {
      if (account.email === email.toLowerCase().trim()) return account;
    }
    return null;
  }

  async findByPhone(phone: string): Promise<BuyerAccount | null> {
    const normalized = phone.replace(/\D/g, "");
    for (const account of this.accounts.values()) {
      if (account.phone?.replace(/\D/g, "") === normalized) return account;
    }
    return null;
  }

  async findByGlobalUserId(globalUserId: string): Promise<BuyerAccount | null> {
    return this.accounts.get(globalUserId) ?? null;
  }

  async findAgentByGlobalUserId(globalUserId: string): Promise<BuyerAgentProfile | null> {
    return this.agents.get(globalUserId) ?? null;
  }

  async saveAgent(agent: BuyerAgentProfile): Promise<void> {
    this.agents.set(agent.globalUserId, agent);
  }

  async findM2mByTokenHash(tokenHash: string): Promise<BuyerAgentProfile | null> {
    for (const agent of this.agents.values()) {
      if (agent.m2mTokenHash === tokenHash) return agent;
    }
    return null;
  }

  clear(): void {
    this.accounts.clear();
    this.agents.clear();
  }
}
