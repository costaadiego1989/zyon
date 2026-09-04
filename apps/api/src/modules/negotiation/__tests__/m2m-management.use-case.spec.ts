import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── In-Memory Store ──────────────────────────────────────────────────────────

interface BuyerAgentRow {
  id: string;
  merchantId: string;
  globalUserId: string;
  displayName: string;
  status: "active" | "suspended";
  m2mSecretHash: string | null;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
  reputation: { transactionCount: number; disputeCount: number; reputationScore: number } | null;
}

interface M2MProtocolConfigRow {
  merchantId: string;
  enabled: boolean;
  webhookUrl: string | null;
  webhookEndpointId: string | null;
  maxSessionTtlMinutes: number;
}

interface M2MManagementStore {
  listAgents(merchantId: string): Promise<BuyerAgentRow[]>;
  createAgent(data: Omit<BuyerAgentRow, "id" | "createdAt" | "updatedAt" | "reputation">): Promise<BuyerAgentRow>;
  findAgentById(merchantId: string, agentId: string): Promise<BuyerAgentRow | null>;
  updateAgentStatus(merchantId: string, agentId: string, status: "active" | "suspended"): Promise<void>;
  getConfig(merchantId: string): Promise<M2MProtocolConfigRow | null>;
  upsertConfig(merchantId: string, data: Partial<M2MProtocolConfigRow>): Promise<M2MProtocolConfigRow>;
}

class InMemoryM2MManagementStore implements M2MManagementStore {
  private agents: BuyerAgentRow[] = [];
  private configs: M2MProtocolConfigRow[] = [];
  private idCounter = 0;

  async listAgents(merchantId: string): Promise<BuyerAgentRow[]> {
    return this.agents
      .filter((a) => a.merchantId === merchantId)
      .sort((a, b) => (b.reputation?.transactionCount ?? 0) - (a.reputation?.transactionCount ?? 0));
  }

  async createAgent(data: Omit<BuyerAgentRow, "id" | "createdAt" | "updatedAt" | "reputation">): Promise<BuyerAgentRow> {
    const existing = this.agents.find(
      (a) => a.merchantId === data.merchantId && a.globalUserId === data.globalUserId
    );
    if (existing) throw new Error("agent_already_exists");
    const now = new Date();
    const row: BuyerAgentRow = {
      ...data,
      id: `agent_${++this.idCounter}`,
      createdAt: now,
      updatedAt: now,
      reputation: { transactionCount: 0, disputeCount: 0, reputationScore: 100 },
    };
    this.agents.push(row);
    return row;
  }

  async findAgentById(merchantId: string, agentId: string): Promise<BuyerAgentRow | null> {
    return this.agents.find((a) => a.merchantId === merchantId && a.id === agentId) ?? null;
  }

  async updateAgentStatus(merchantId: string, agentId: string, status: "active" | "suspended"): Promise<void> {
    const agent = this.agents.find((a) => a.merchantId === merchantId && a.id === agentId);
    if (!agent) throw new Error("agent_not_found");
    agent.status = status;
    agent.updatedAt = new Date();
  }

  async getConfig(merchantId: string): Promise<M2MProtocolConfigRow | null> {
    return this.configs.find((c) => c.merchantId === merchantId) ?? null;
  }

  async upsertConfig(merchantId: string, data: Partial<M2MProtocolConfigRow>): Promise<M2MProtocolConfigRow> {
    const existing = this.configs.find((c) => c.merchantId === merchantId);
    if (existing) {
      Object.assign(existing, data);
      return existing;
    }
    const row: M2MProtocolConfigRow = {
      merchantId,
      enabled: data.enabled ?? false,
      webhookUrl: data.webhookUrl ?? null,
      webhookEndpointId: data.webhookEndpointId ?? null,
      maxSessionTtlMinutes: data.maxSessionTtlMinutes ?? 30,
    };
    this.configs.push(row);
    return row;
  }
}

// ── Use Cases ────────────────────────────────────────────────────────────────

class ListM2MAgentsUseCase {
  constructor(private readonly store: M2MManagementStore) {}
  async execute(merchantId: string) {
    return this.store.listAgents(merchantId);
  }
}

class CreateM2MAgentUseCase {
  constructor(private readonly store: M2MManagementStore) {}
  async execute(merchantId: string, input: { displayName: string; globalUserId: string; scopes?: string[] }) {
    if (!input.displayName.trim()) throw new Error("display_name_required");
    if (!input.globalUserId.trim()) throw new Error("global_user_id_required");
    const secretHash = `hmac_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
    return this.store.createAgent({
      merchantId,
      globalUserId: input.globalUserId.trim(),
      displayName: input.displayName.trim(),
      status: "active",
      m2mSecretHash: secretHash,
      scopes: input.scopes ?? ["read", "negotiate"],
    });
  }
}

class SuspendM2MAgentUseCase {
  constructor(private readonly store: M2MManagementStore) {}
  async execute(merchantId: string, agentId: string, suspend: boolean) {
    const agent = await this.store.findAgentById(merchantId, agentId);
    if (!agent) throw new Error("agent_not_found");
    await this.store.updateAgentStatus(merchantId, agentId, suspend ? "suspended" : "active");
  }
}

class GetProtocolConfigUseCase {
  constructor(private readonly store: M2MManagementStore) {}
  async execute(merchantId: string): Promise<M2MProtocolConfigRow> {
    const config = await this.store.getConfig(merchantId);
    return config ?? { merchantId, enabled: false, webhookUrl: null, webhookEndpointId: null, maxSessionTtlMinutes: 30 };
  }
}

class UpsertProtocolConfigUseCase {
  constructor(private readonly store: M2MManagementStore) {}
  async execute(merchantId: string, data: { enabled?: boolean; webhookUrl?: string | null; maxSessionTtlMinutes?: number }) {
    if (data.webhookUrl && !data.webhookUrl.startsWith("https://")) {
      throw new Error("webhook_url_must_be_https");
    }
    if (data.maxSessionTtlMinutes !== undefined && (data.maxSessionTtlMinutes < 1 || data.maxSessionTtlMinutes > 1440)) {
      throw new Error("ttl_out_of_range");
    }
    return this.store.upsertConfig(merchantId, data);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M2M Management Use Cases", () => {
  let store: InMemoryM2MManagementStore;

  beforeEach(() => {
    store = new InMemoryM2MManagementStore();
  });

  describe("ListM2MAgentsUseCase", () => {
    it("returns agents sorted by transactionCount desc", async () => {
      const uc = new ListM2MAgentsUseCase(store);
      const a1 = await store.createAgent({ merchantId: "m1", globalUserId: "g1", displayName: "Agent A", status: "active", m2mSecretHash: null, scopes: [] });
      const a2 = await store.createAgent({ merchantId: "m1", globalUserId: "g2", displayName: "Agent B", status: "active", m2mSecretHash: null, scopes: [] });
      a1.reputation = { transactionCount: 5, disputeCount: 0, reputationScore: 100 };
      a2.reputation = { transactionCount: 20, disputeCount: 1, reputationScore: 95 };

      const result = await uc.execute("m1");
      assert.equal(result[0].displayName, "Agent B");
      assert.equal(result[1].displayName, "Agent A");
    });

    it("enforces merchant isolation", async () => {
      const uc = new ListM2MAgentsUseCase(store);
      await store.createAgent({ merchantId: "m1", globalUserId: "g1", displayName: "M1 Agent", status: "active", m2mSecretHash: null, scopes: [] });
      await store.createAgent({ merchantId: "m2", globalUserId: "g2", displayName: "M2 Agent", status: "active", m2mSecretHash: null, scopes: [] });

      const result = await uc.execute("m1");
      assert.equal(result.length, 1);
      assert.equal(result[0].displayName, "M1 Agent");
    });
  });

  describe("CreateM2MAgentUseCase", () => {
    it("generates unique secret hash", async () => {
      const uc = new CreateM2MAgentUseCase(store);
      const agent = await uc.execute("m1", { displayName: "Bot", globalUserId: "buyer-1" });
      assert.ok(agent.m2mSecretHash);
      assert.ok(agent.m2mSecretHash!.startsWith("hmac_"));
      assert.equal(agent.status, "active");
      assert.deepEqual(agent.scopes, ["read", "negotiate"]);
    });

    it("rejects duplicate globalUserId per merchant", async () => {
      const uc = new CreateM2MAgentUseCase(store);
      await uc.execute("m1", { displayName: "Bot A", globalUserId: "buyer-1" });
      await assert.rejects(() => uc.execute("m1", { displayName: "Bot B", globalUserId: "buyer-1" }), { message: "agent_already_exists" });
    });

    it("rejects empty displayName", async () => {
      const uc = new CreateM2MAgentUseCase(store);
      await assert.rejects(() => uc.execute("m1", { displayName: "  ", globalUserId: "buyer-1" }), { message: "display_name_required" });
    });

    it("allows same globalUserId for different merchants", async () => {
      const uc = new CreateM2MAgentUseCase(store);
      const a1 = await uc.execute("m1", { displayName: "Bot", globalUserId: "buyer-shared" });
      const a2 = await uc.execute("m2", { displayName: "Bot", globalUserId: "buyer-shared" });
      assert.notEqual(a1.id, a2.id);
    });
  });

  describe("SuspendM2MAgentUseCase", () => {
    it("suspends an active agent", async () => {
      const uc = new SuspendM2MAgentUseCase(store);
      const agent = await store.createAgent({ merchantId: "m1", globalUserId: "g1", displayName: "Bot", status: "active", m2mSecretHash: null, scopes: [] });
      await uc.execute("m1", agent.id, true);
      const updated = await store.findAgentById("m1", agent.id);
      assert.equal(updated!.status, "suspended");
    });

    it("is idempotent (suspend → suspend = no error)", async () => {
      const uc = new SuspendM2MAgentUseCase(store);
      const agent = await store.createAgent({ merchantId: "m1", globalUserId: "g1", displayName: "Bot", status: "active", m2mSecretHash: null, scopes: [] });
      await uc.execute("m1", agent.id, true);
      await uc.execute("m1", agent.id, true); // no throw
      const updated = await store.findAgentById("m1", agent.id);
      assert.equal(updated!.status, "suspended");
    });

    it("reactivates a suspended agent", async () => {
      const uc = new SuspendM2MAgentUseCase(store);
      const agent = await store.createAgent({ merchantId: "m1", globalUserId: "g1", displayName: "Bot", status: "suspended", m2mSecretHash: null, scopes: [] });
      await uc.execute("m1", agent.id, false);
      const updated = await store.findAgentById("m1", agent.id);
      assert.equal(updated!.status, "active");
    });

    it("throws for non-existent agent", async () => {
      const uc = new SuspendM2MAgentUseCase(store);
      await assert.rejects(() => uc.execute("m1", "fake_id", true), { message: "agent_not_found" });
    });
  });

  describe("GetProtocolConfigUseCase", () => {
    it("returns defaults when no config exists", async () => {
      const uc = new GetProtocolConfigUseCase(store);
      const config = await uc.execute("m1");
      assert.equal(config.enabled, false);
      assert.equal(config.webhookUrl, null);
      assert.equal(config.maxSessionTtlMinutes, 30);
    });

    it("returns stored config", async () => {
      const uc = new GetProtocolConfigUseCase(store);
      await store.upsertConfig("m1", { enabled: true, webhookUrl: "https://example.com/hook", maxSessionTtlMinutes: 60 });
      const config = await uc.execute("m1");
      assert.equal(config.enabled, true);
      assert.equal(config.webhookUrl, "https://example.com/hook");
      assert.equal(config.maxSessionTtlMinutes, 60);
    });
  });

  describe("UpsertProtocolConfigUseCase", () => {
    it("validates webhook URL must be HTTPS", async () => {
      const uc = new UpsertProtocolConfigUseCase(store);
      await assert.rejects(
        () => uc.execute("m1", { webhookUrl: "http://example.com/hook" }),
        { message: "webhook_url_must_be_https" }
      );
    });

    it("validates TTL range (1-1440)", async () => {
      const uc = new UpsertProtocolConfigUseCase(store);
      await assert.rejects(() => uc.execute("m1", { maxSessionTtlMinutes: 0 }), { message: "ttl_out_of_range" });
      await assert.rejects(() => uc.execute("m1", { maxSessionTtlMinutes: 1441 }), { message: "ttl_out_of_range" });
    });

    it("creates config when none exists", async () => {
      const uc = new UpsertProtocolConfigUseCase(store);
      const config = await uc.execute("m1", { enabled: true, webhookUrl: "https://hooks.io/m2m" });
      assert.equal(config.enabled, true);
      assert.equal(config.webhookUrl, "https://hooks.io/m2m");
    });

    it("updates existing config partially", async () => {
      const uc = new UpsertProtocolConfigUseCase(store);
      await uc.execute("m1", { enabled: true, webhookUrl: "https://hooks.io/m2m", maxSessionTtlMinutes: 60 });
      const updated = await uc.execute("m1", { maxSessionTtlMinutes: 15 });
      assert.equal(updated.enabled, true);
      assert.equal(updated.webhookUrl, "https://hooks.io/m2m");
      assert.equal(updated.maxSessionTtlMinutes, 15);
    });
  });
});
