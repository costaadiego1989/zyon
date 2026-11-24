import { ProspectConversionHistoryQuery } from "../application/billing/prospect-conversion-history.query.js";
import { SearchCompaniesQuery } from "../application/company-directory/search-companies.query.js";
import { CompanyImportService } from "../application/company-directory/company-import.service.js";
import { ProspectService } from "../application/crm/prospect.service.js";
import { ProspectMetricsQueryService } from "../application/crm/prospect-metrics.query.js";
import { ProspectConversationService } from "../application/conversations/prospect-conversation.service.js";
import { ProcessProspectInbound } from "../application/conversations/process-prospect-inbound.service.js";
import { CampaignService } from "../application/campaigns/campaign.service.js";
import {PrismaCampaignPreparation} from "./campaigns/prisma-campaign-preparation.js";
import {CampaignPreparation,CampaignExecutionIdentity} from "../application/campaigns/campaign-preparation.js";
import {CampaignDraftService} from "../application/campaigns/campaign-drafts.js";
import {PrismaCampaignDrafts} from "./campaigns/prisma-campaign-drafts.js";
import {CampaignDraftAudience} from "../application/campaigns/campaign-draft-audience.js";
import {PrismaCampaignDraftAudience} from "./campaigns/prisma-campaign-draft-audience.js";
import {CampaignPlanner} from "../application/campaigns/campaign-planner.js";
import {PrismaCampaignPlanner} from "./campaigns/prisma-campaign-planner.js";
import {CampaignPlanningModelAdapter} from "./campaigns/campaign-planning-model.adapter.js";
import {PlatformTemplateService} from "../application/campaigns/platform-template.service.js";
import {PrismaPlatformTemplateStore} from "./campaigns/prisma-platform-template.store.js";
import {MetaPlatformTemplateAdapter} from "./campaigns/meta-platform-template.adapter.js";
import { FreezeCampaignAudience } from "../application/campaigns/freeze-campaign-audience.js";
import { SenderReadinessService } from "../application/campaigns/sender-readiness.service.js";
import { PlatformSenderOnboardingService } from "../application/campaigns/platform-sender-onboarding.service.js";
import { QuerySalesKnowledge } from "../application/knowledge/query-sales-knowledge.js";
import { ZyonSalesAgentService } from "../application/knowledge/zyon-sales-agent.service.js";
import { ProspectBillingBridgeService } from "../application/billing/prospect-billing-bridge.service.js";
import { PrismaDirectoryRepository } from "./company-directory/prisma-directory.repository.js";
import { PrismaProspectRepository } from "./crm/prisma-prospect.repository.js";
import { PrismaSegmentRepository } from "./crm/prisma-segment.repository.js";
import { PrismaSenderBindingRepository } from "./campaigns/prisma-sender-binding.repository.js";
import { PrismaSenderObservationStore } from "./campaigns/prisma-sender-observation.store.js";
import { PrismaCampaignCommands } from "./campaigns/prisma-campaign-commands.js";
import { PrismaAudienceRepository } from "./campaigns/prisma-audience.repository.js";
import { PrismaProspectConversationRepository } from "./conversations/prisma-prospect-conversation.repository.js";
import { PrismaProspectConversationCommands } from "./conversations/prisma-prospect-conversation-commands.js";
import { PrismaProspectMetaInbox } from "./conversations/prisma-prospect-meta-inbox.js";
import { PrismaSalesKnowledgeRepository } from "./knowledge/prisma-sales-knowledge.repository.js";
import {
  Neo4jSalesKnowledgeAdapter,
  SalesPublicationService,
} from "./knowledge/neo4j-sales-knowledge.adapter.js";
import { Neo4jSalesKnowledgeReader } from "./knowledge/neo4j-sales-knowledge.reader.js";
import { PrismaProspectBillingStore } from "./billing/prisma-prospect-billing.store.js";
import { PublicSubscriptionFacts } from "../../payment/public-subscription-facts.js";
import { PlatformSalesOffers } from "../../payment/public-platform-sales-offers.js";

import { Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import neo4j from "neo4j-driver";
import {
  loadProspectingConfig,
  assertSameProspectingDatabase,
} from "./prospecting-config.js";
import { createDirectoryPrismaClient } from "./company-directory/directory-prisma-client.js";
import { ReceitaManifestAdapter } from "./company-directory/receita-manifest.adapter.js";
import { CnpjArchiveReader } from "./company-directory/cnpj-archive-reader.js";
import { ImportCompanySnapshotWorker } from "../application/company-directory/import-company-snapshot.worker.js";
import { PrismaCampaignRepository } from "./campaigns/prisma-campaign.repository.js";
import { MetaProspectingSenderAdapter } from "./campaigns/meta-prospecting-sender.adapter.js";
import { MetaSenderHealthReader } from "./campaigns/meta-sender-health.reader.js";
import { PlatformMetaAuthorization } from "./campaigns/platform-meta-authorization.js";
import { ZyonSalesLlmAdapter } from "./knowledge/zyon-sales-llm.adapter.js";
import { ProspectDispatchWorker } from "../application/campaigns/prospect-dispatch.worker.js";
import { ProspectFollowUpWorker } from "../application/campaigns/prospect-follow-up.worker.js";
import { ProspectOperationalStatus } from "../application/crm/prospect-operational-status.js";
import { recoverProspectSubmissions } from "./prospecting-recovery.js";
import { ProspectEffectQueue } from "./prospecting-workers.js";
import type { SenderObservationStore } from "../application/campaigns/sender-readiness.service.js";
import { PrismaProspectPrivacyRepository } from "./crm/prisma-prospect-privacy.repository.js";
type Environment = Readonly<Record<string, string | undefined>>;
const logger = new Logger("PlatformProspecting");
const unavailable = async (): Promise<never> => {
  throw Error("sender_unavailable");
};

export function createProspectingRuntime(env: Environment = process.env) {
  const config = loadProspectingConfig(env);
  if (!config.enabled) throw Error("prospecting_disabled");
  const field = (key: string) => env["PROSPECTING_" + key]?.trim() ?? "";
  const amount = (key: string) => {
    const text = field(key);
    const n = Number(text);
    return /^\d+$/.test(text) && Number.isSafeInteger(n) ? n : null;
  };
  const enabledWorkers = field("RUN_WORKERS") === "true";
  if (field("RUN_WORKERS") && !["true", "false"].includes(field("RUN_WORKERS")))
    throw Error("config_invalid:RUN_WORKERS");
  if (env.DATABASE_URL)
    assertSameProspectingDatabase(env.DATABASE_URL, config.databaseUrl!);
  const secret = field("PROPOSAL_SECRET"),
    ttl = amount("PROPOSAL_TTL_SECONDS");
  if (
    secret.length < 32 ||
    [
      config.cursorHmacKey,
      config.senderEncryptionKey,
      config.suppressionHmacKey,
      env.JWT_SECRET,
      env.PLATFORM_CONTROL_JWT_SECRET,
      env.PLATFORM_JWT_SECRET,
    ].includes(secret)
  )
    throw Error("config_invalid:PROPOSAL_SECRET");
  if (!ttl || !Number.isSafeInteger(ttl * 1000))
    throw Error("config_invalid:PROPOSAL_TTL_SECONDS");
  const offers = new PlatformSalesOffers(
    field("DASHBOARD_ORIGIN"),
    field("PUBLIC_SITE_URL") || undefined
  );
  const model = field("LLM_MODEL"),
    modelKey = field("LLM_API_KEY");
  if (
    config.llmRealEnabled &&
    (!model ||
      !modelKey ||
      !amount("LLM_INPUT_MICROCENTS_PER_TOKEN") ||
      !amount("LLM_OUTPUT_MICROCENTS_PER_TOKEN"))
  )
    throw Error("config_invalid:llm_pricing");
  const db = new PrismaClient({
    datasources: { db: { url: config.databaseUrl! } },
  });
  const client = createDirectoryPrismaClient({
    databaseUrl: config.databaseUrl!,
    directoryDatabaseUrl: config.directoryDatabaseUrl!,
    directoryPoolSize: config.directoryPoolSize,
  });
  const readDriver = neo4j.driver(
    config.neo4jReadUri!,
    neo4j.auth.basic(config.neo4jReadUser!, config.neo4jReadPassword!)
  );
  const writeDriver = neo4j.driver(
    config.neo4jIngestUri!,
    neo4j.auth.basic(config.neo4jIngestUser!, config.neo4jIngestPassword!)
  );
  let historical: Record<string, string> = {};
  if (field("SUPPRESSION_PREVIOUS_KEYS")) {
    try {
      historical = JSON.parse(field("SUPPRESSION_PREVIOUS_KEYS"));
    } catch {
      throw Error("config_invalid:suppression_keys");
    }
    if (
      !historical ||
      typeof historical !== "object" ||
      Array.isArray(historical) ||
      Object.entries(historical).some(
        ([version, key]) =>
          !/^[1-9]\d*$/.test(version) ||
          Number(version) >= config.suppressionKeyVersion ||
          typeof key !== "string" ||
          !/^[a-f0-9]{64}$/i.test(key)
      )
    )
      throw Error("config_invalid:suppression_keys");
  }
  const keys = {
    currentVersion: config.suppressionKeyVersion,
    keys: {
      ...historical,
      [config.suppressionKeyVersion]: config.suppressionHmacKey!,
    },
  };
  const directory = new PrismaDirectoryRepository(
    client,
    config.cursorHmacKey!
  );
  const search = new SearchCompaniesQuery(directory, config.cursorHmacKey!);
  const source = new ReceitaManifestAdapter();
  const importService = new CompanyImportService(directory, source, config);
  const {
    importMaximumFileBytes,
    importMaximumExpandedBytes,
    importMaximumEntries,
    importMaximumLineBytes,
    importMaximumMemoryBytes,
    importMinimumFreeDiskBytes,
  } = config;
  const archives = new CnpjArchiveReader(source, {
    importMaximumFileBytes,
    importMaximumExpandedBytes,
    importMaximumEntries,
    importMaximumLineBytes,
    importMaximumMemoryBytes,
    importMinimumFreeDiskBytes,
  });
  const importer = new ImportCompanySnapshotWorker(directory, archives, config);
  const crm = new PrismaProspectRepository(db, directory),
    prospects = new ProspectService(crm);
  const privacy = new PrismaProspectPrivacyRepository(db, directory, keys),
    segments = new PrismaSegmentRepository(db);
  const store = new PrismaProspectBillingStore(db, ttl * 1000);
  const bridge = new ProspectBillingBridgeService(
    store,
    offers,
    new PublicSubscriptionFacts(db),
    secret
  );
  const signup = {
    appId: field("META_APP_ID"),
    configId: field("META_CONFIG_ID"),
    businessId: field("META_BUSINESS_ID"),
    phoneNumberId: field("META_PHONE_NUMBER_ID"),
    appSecret: field("META_APP_SECRET"),
    registrationPin: field("META_REGISTRATION_PIN"),
    encryptionKey: config.senderEncryptionKey ?? "",
  };
  const canConnect =
    !!config.senderEncryptionKey &&
    [
      signup.appId,
      signup.configId,
    ].every((id) => /^\d+$/.test(id)) &&
    !!signup.appSecret;
  const onboarding = canConnect
    ? new PlatformSenderOnboardingService(
        signup,
        new PrismaSenderBindingRepository(db, signup.encryptionKey),
        new PlatformMetaAuthorization(signup)
      )
    : { signupState: unavailable, connect: unavailable };
  const observations: SenderObservationStore = config.senderEncryptionKey
    ? new PrismaSenderObservationStore(db, config.senderEncryptionKey)
    : {
        credential: async () => null,
        save: unavailable,
        permission: unavailable,
      };
  const health = new SenderReadinessService(
    observations,
    new MetaSenderHealthReader(signup)
  );
  const sender = MetaProspectingSenderAdapter.official(observations, config);
  const quote = (key: string, now: Date) => {
    const amountCents = amount(key),
      validUntil = new Date(field("META_QUOTE_VALID_UNTIL"));
    return amountCents === null || !(validUntil > now)
      ? null
      : { amountCents, currency: "BRL" as const, validUntil };
  };
  const sources = new PrismaSalesKnowledgeRepository(db);
  const templates=new PlatformTemplateService(new PrismaPlatformTemplateStore(db),observations,new MetaPlatformTemplateAdapter(),health);
  const executionIdentity=new CampaignExecutionIdentity(offers,async()=>{
    if(!enabledWorkers)throw Error("workers_disabled");
    if(!config.metaSendEnabled)throw Error("dispatch_disabled");
    if(!config.llmRealEnabled||!model||!modelKey||!config.llmMaximumCostCents||!amount("LLM_INPUT_MICROCENTS_PER_TOKEN")||!amount("LLM_OUTPUT_MICROCENTS_PER_TOKEN"))throw Error("model_disabled");
    const now=new Date(),templateQuote=quote("META_TEMPLATE_COST_CENTS",now),replyQuote=quote("META_REPLY_COST_CENTS",now);
    if(!templateQuote?.amountCents||!replyQuote?.amountCents)throw Error("cost_unknown");
    await readDriver.verifyConnectivity();
    const knowledge=await sources.active(now);if(!knowledge.length)throw Error("knowledge_unavailable");
    return {knowledge,model,maximumCostCents:config.llmMaximumCostCents,input:amount("LLM_INPUT_MICROCENTS_PER_TOKEN"),output:amount("LLM_OUTPUT_MICROCENTS_PER_TOKEN"),templateQuote,replyQuote};
  });
  const executionCurrent=executionIdentity.current.bind(executionIdentity);
  const reservations=new PrismaCampaignRepository(db,keys,({now})=>quote("META_TEMPLATE_COST_CENTS",now));
  const dispatch=new ProspectDispatchWorker(reservations,health,offers,sender,()=>new Date(),executionCurrent);
  const campaign=new CampaignService(new PrismaCampaignCommands(db,offers,c=>health.forCampaign(c),executionCurrent));
  const audienceStore=new PrismaAudienceRepository(db,keys);
  const audience=new FreezeCampaignAudience(audienceStore);
  const preparation=new CampaignPreparation(new PrismaCampaignPreparation(db,templates,executionIdentity,audienceStore));
  const publications = new SalesPublicationService(
    sources,
    new Neo4jSalesKnowledgeAdapter(writeDriver)
  );
  const query = new QuerySalesKnowledge(
    sources,
    new Neo4jSalesKnowledgeReader(readDriver, config.knowledgeTimeoutMs),
    (event) => logger.debug({ event: "published_knowledge_read", ...event })
  );
  const history = new PrismaProspectConversationRepository(db);
  const commands = new PrismaProspectConversationCommands(
    history,
    keys,
    ({ now }) => quote("META_REPLY_COST_CENTS", now),
    offers,
    store.chatLinks(bridge)
  );
  const conversation = new ProspectConversationService(
    history,
    commands,
    health,
    sender
  );
  const llm = new ZyonSalesLlmAdapter(
    {
      enabled: config.llmRealEnabled,
      apiKey: modelKey,
      model,
      timeoutMs: config.llmTimeoutMs,
      maximumCostCents: config.llmMaximumCostCents ?? 0,
      quote: ({ bodyBytes, maximumOutputTokens }) =>
        Math.ceil(
          (bodyBytes * (amount("LLM_INPUT_MICROCENTS_PER_TOKEN") ?? 0) +
            maximumOutputTokens *
              (amount("LLM_OUTPUT_MICROCENTS_PER_TOKEN") ?? 0)) /
            1000000
        ),
    },
    commands
  );
  const agent = new ZyonSalesAgentService(
    commands,
    conversation,
    query,
    offers,
    llm,
    {
      maximumCostCents: config.llmMaximumCostCents ?? 0,
      timeoutMs: config.llmTimeoutMs,
    }
  );
  const planner=new CampaignPlanner(new PrismaCampaignPlanner(db,new CampaignPlanningModelAdapter({enabled:config.llmRealEnabled,apiKey:modelKey,model,timeoutMs:config.llmTimeoutMs,maximumCostCents:config.llmMaximumCostCents??0,quote:({bodyBytes,maximumOutputTokens})=>{
    const input=amount("LLM_INPUT_MICROCENTS_PER_TOKEN"),output=amount("LLM_OUTPUT_MICROCENTS_PER_TOKEN");
    return input&&output?Math.ceil((bodyBytes*input+maximumOutputTokens*output)/1000000):null;
  }})));
  const inbox = new PrismaProspectMetaInbox(db, keys),
    inbound = new ProcessProspectInbound(history);
  const queue = new ProspectEffectQueue(
    db,
    commands,
    agent,
    conversation,
    dispatch,
    new ProspectFollowUpWorker(reservations, dispatch)
  );
  let started = false,
    stopped = false,
    timer: NodeJS.Timeout | undefined,
    running: Promise<void> | undefined,
    importing: Promise<void> | undefined;
  const status = new ProspectOperationalStatus(
    {
      runtime: () => ({
        moduleEnabled: true,
        workersRunning: started && !stopped,
        dispatchMode: config.metaSendEnabled ? "live" : "disabled",
        modelMode: config.llmRealEnabled ? "live" : "disabled",
        ingestionEnabled: config.ingestionEnabled,
      }),
      channel: () => health.readiness(),
      async source() {
        return directory.sourceObservation();
      },
      async knowledge() {
        await readDriver.verifyConnectivity();
        return {
          activePublications: (await sources.active(new Date())).length,
        };
      },
    },
    offers
  );
  async function isolated(name: string, work: () => Promise<unknown>) {
    try {
      await work();
    } catch (error) {
      logger.warn({
        worker: name,
        code:
          error instanceof Error && /^[a-z_]{1,80}$/.test(error.message)
            ? error.message
            : "worker_unavailable",
      });
    }
  }
  async function cycle() {
    if (!enabledWorkers || stopped) return;
    if (config.ingestionEnabled && !importing)
      importing = isolated("directory", async () => {
        for (const id of await directory.pendingImports(10)) {
          if (stopped) break;
          await importer.run(id);
        }
      }).finally(() => {
        importing = undefined;
      });
    await isolated("audience", () => audience.processNext(100));
    await isolated("planning",()=>planner.processNext());
    await isolated("recovery", () => recoverProspectSubmissions(db, reservations, commands));
    await isolated("inbound", () => inbound.processNext(25));
    await isolated("sales", () =>
      queue.replies("prospect.ai.reply", config.llmRealEnabled)
    );
    if (config.metaSendEnabled && !stopped)
      await isolated("dispatch", () => queue.sends());
    await isolated("retention", async () => {
      const last = await db.prospectRetentionRun.findUnique({
        where: { id: "daily" },
      });
      if (!last || last.nextRunAt <= new Date())
        await privacy.retain(new Date(), 100);
    });
  }
  function tick() {
    return (running ??= cycle().finally(() => {
      running = undefined;
    }));
  }
  return {
    db,
    directory,
    search,
    importService,
    crm,
    prospects,
    privacy,
    segments,
    offers,
    bridge,
    onboarding,
    health,
    sender: {
      readiness: () => health.readiness(),
      send: sender.send.bind(sender),
    },
    reservations,
    campaign,
    drafts:new CampaignDraftService(new PrismaCampaignDrafts(db)),
    draftAudience:new CampaignDraftAudience(new PrismaCampaignDraftAudience(db)),
    planner,
    templates,
    preparation,
    audience,
    sources,
    publications,
    query,
    commands,
    history,
    conversation,
    llm,
    inbox,
    status,
    metrics: new ProspectMetricsQueryService(db),
    conversions: new ProspectConversionHistoryQuery(db),
    tick,
    onModuleInit() {
      if (enabledWorkers && !started && !stopped) {
        started = true;
        timer = setInterval(() => {
          void tick();
        }, 5000);
        timer.unref();
      }
    },
    async onModuleDestroy() {
      stopped = true;
      clearInterval(timer);
      await running;
      await importing;
      await Promise.all([
        client.$disconnect(),
        db.$disconnect(),
        readDriver.close(),
        writeDriver.close(),
      ]);
    },
  };
}
export type ProspectingRuntime = ReturnType<typeof createProspectingRuntime>;
