import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";

// ── Port Interface ───────────────────────────────────────────────────────────

export const M2M_MANAGEMENT_STORE = Symbol("M2M_MANAGEMENT_STORE");

export interface BuyerAgentRow {
  id: string;
  merchantId: string;
  globalUserId: string;
  displayName: string;
  status: "active" | "suspended";
  m2mSecretHash: string | null;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  reputation: { transactionCount: number; disputeCount: number; reputationScore: number } | null;
}

export interface M2MProtocolConfigRow {
  merchantId: string;
  enabled: boolean;
  webhookUrl: string | null;
  webhookEndpointId: string | null;
  maxSessionTtlMinutes: number;
}

export interface M2MManagementStore {
  listAgents(merchantId: string): Promise<BuyerAgentRow[]>;
  createAgent(data: Omit<BuyerAgentRow, "id" | "createdAt" | "updatedAt" | "reputation">): Promise<BuyerAgentRow>;
  findAgentById(merchantId: string, agentId: string): Promise<BuyerAgentRow | null>;
  updateAgentStatus(merchantId: string, agentId: string, status: "active" | "suspended"): Promise<void>;
  getConfig(merchantId: string): Promise<M2MProtocolConfigRow | null>;
  upsertConfig(merchantId: string, data: Partial<M2MProtocolConfigRow>): Promise<M2MProtocolConfigRow>;
}

// ── Use Cases ────────────────────────────────────────────────────────────────

@Injectable()
export class ListM2MAgentsUseCase {
  constructor(@Inject(M2M_MANAGEMENT_STORE) private readonly store: M2MManagementStore) {}

  async execute(merchantId: string): Promise<BuyerAgentRow[]> {
    return this.store.listAgents(merchantId);
  }
}

@Injectable()
export class CreateM2MAgentUseCase {
  private readonly logger = new Logger(CreateM2MAgentUseCase.name);

  constructor(@Inject(M2M_MANAGEMENT_STORE) private readonly store: M2MManagementStore) {}

  async execute(merchantId: string, input: { displayName: string; globalUserId: string; scopes?: string[]; expiresInDays?: number }): Promise<BuyerAgentRow> {
    if (!input.displayName.trim()) throw new Error("display_name_required");
    if (!input.globalUserId.trim()) throw new Error("global_user_id_required");
    const secretHash = `hmac_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;
    return this.store.createAgent({
      merchantId,
      globalUserId: input.globalUserId.trim(),
      displayName: input.displayName.trim(),
      status: "active",
      m2mSecretHash: secretHash,
      scopes: input.scopes ?? ["read", "negotiate"],
      expiresAt,
    });
  }
}

@Injectable()
export class SuspendM2MAgentUseCase {
  constructor(@Inject(M2M_MANAGEMENT_STORE) private readonly store: M2MManagementStore) {}

  async execute(merchantId: string, agentId: string, suspend: boolean): Promise<void> {
    const agent = await this.store.findAgentById(merchantId, agentId);
    if (!agent) throw new NotFoundException("agent_not_found");
    await this.store.updateAgentStatus(merchantId, agentId, suspend ? "suspended" : "active");
  }
}

@Injectable()
export class GetProtocolConfigUseCase {
  constructor(@Inject(M2M_MANAGEMENT_STORE) private readonly store: M2MManagementStore) {}

  async execute(merchantId: string): Promise<M2MProtocolConfigRow> {
    const config = await this.store.getConfig(merchantId);
    return config ?? { merchantId, enabled: false, webhookUrl: null, webhookEndpointId: null, maxSessionTtlMinutes: 30 };
  }
}

@Injectable()
export class UpsertProtocolConfigUseCase {
  constructor(@Inject(M2M_MANAGEMENT_STORE) private readonly store: M2MManagementStore) {}

  async execute(merchantId: string, data: { enabled?: boolean; webhookUrl?: string | null; maxSessionTtlMinutes?: number }): Promise<M2MProtocolConfigRow> {
    if (data.webhookUrl && !data.webhookUrl.startsWith("https://")) {
      throw new Error("webhook_url_must_be_https");
    }
    if (data.maxSessionTtlMinutes !== undefined && (data.maxSessionTtlMinutes < 1 || data.maxSessionTtlMinutes > 1440)) {
      throw new Error("ttl_out_of_range");
    }
    return this.store.upsertConfig(merchantId, data);
  }
}
