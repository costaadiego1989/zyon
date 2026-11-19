import { readFile } from "node:fs/promises";
import { cashbackConfigurationFixture } from "../../infrastructure/__tests__/cashback-configuration.fixture.js";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import { AiGovernanceService } from "../../../ai-governance/ai-governance.service.js";
import { PrismaMerchantStoreRepository } from "../../../merchant/infrastructure/prisma-merchant-store.repository.js";
import { createMerchantAssistantRuntime } from "../../../merchant-assistant/infrastructure/runtime.js";
import { CashbackAssistantContext } from "../cashback-assistant.context.js";
import { CashbackAssistantReportService } from "../cashback-assistant-report.service.js";

export async function cashbackAssistantFixture() {
  const f = await cashbackConfigurationFixture(), tenant = new TenantContextService(), requests: any[] = [], graphRequests: any[] = [];
  try {
    await f.db.query(`CREATE TABLE merchants(id TEXT PRIMARY KEY,billing_account_merchant_id TEXT);
      INSERT INTO merchants(id) VALUES ('merchant-a'),('merchant-b');
      CREATE TABLE merchant_team_members(id TEXT PRIMARY KEY,merchant_id TEXT,user_id TEXT,role TEXT,UNIQUE(merchant_id,user_id));
      INSERT INTO merchant_team_members VALUES ('a','merchant-a','owner-a','OWNER'),('b','merchant-a','admin-a','ADMIN'),('c','merchant-a','staff-a','STAFF'),('d','merchant-b','owner-b','OWNER');
      CREATE TABLE ai_usage_events(merchant_id TEXT,started_at TIMESTAMP);
      CREATE TABLE ai_price_versions(id TEXT PRIMARY KEY,version TEXT,provider TEXT,model TEXT,channel TEXT,component TEXT,currency TEXT,input_micros_per_million BIGINT,output_micros_per_million BIGINT,effective_from TIMESTAMP,effective_to TIMESTAMP,source TEXT,created_at TIMESTAMP,rates JSONB);
      INSERT INTO ai_price_versions VALUES ('local','local','openai','gpt-4o-mini','chat','text_generation','USD',1000000,2000000,'2026-01-01',NULL,'local',now(),'{}');`);
    for (const migration of ["20261116103000_merchant_assistant", "20261028010000_ai_governance"]) await f.db.query(await readFile(new URL(`../../../../../prisma/migrations/${migration}/migration.sql`, import.meta.url), "utf8"));
    const governance = new AiGovernanceService(f.prisma, tenant), memberships = new PrismaMerchantStoreRepository(f.prisma);
    const env = { MERCHANT_ASSISTANT_ENABLED: "true", MERCHANT_ASSISTANT_PROVIDER: "openai", OPENAI_API_KEY: "local-controlled-key", OPENAI_MODEL: "gpt-4o-mini", DASHBOARD_URL: "https://dashboard.example.test" };
    let modelReply: ((body: any) => unknown) | undefined;
    const runtime = createMerchantAssistantRuntime({ prisma: f.prisma, memberships, tenant, governance, env, graph: { enabledFor: () => true,
      searchMerchantGuides: async input => { graphRequests.push(input); return { status: "unavailable", reason: "disabled" }; } },
      transport: async (_url, init) => {
        const body = JSON.parse(String(init?.body)); requests.push(body);
        const message = modelReply?.(body) ?? (body.messages.some((m: any) => m.role === "tool")
          ? { content: JSON.stringify({ reply: "Ativei a configuração.", referenceIds: [] }) }
          : { tool_calls: [{ id: "next", type: "function", function: { name: "cashback_next_step", arguments: "{}" } }] });
        return new Response(JSON.stringify({ id: `local-${requests.length}`, model: "gpt-4o-mini", choices: [{ finish_reason: "stop", message }], usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 } }), { status: 200 });
      } });
    return { ...f, tenant, governance, memberships, runtime, env, requests, graphRequests, modelReply: (fn: typeof modelReply) => { modelReply = fn; },
      register() { const context = new CashbackAssistantContext({ service: f.service, reports: new CashbackAssistantReportService(f.queries), conversations: runtime.repo, authorizeActor: runtime.authorizeActor, authorizeTool: runtime.authorizeTool }); runtime.contexts.register(context); return context; },
      async close() { await runtime.worker.onModuleDestroy(); await f.close(); } };
  } catch (error) { await f.close(); throw error; }
}
