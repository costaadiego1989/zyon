import assert from "node:assert/strict";
import { test } from "node:test";
import { createCampaignFixture } from "../../../tests/prospect-campaign-fixture.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  createCompanyDirectoryFixture,
  fixtureManifest,
  fixtureSourceRows,
  directoryArchiveLimits,
  companyDirectoryZip,
  csv,
} from "../../../tests/company-directory-fixture.js";
import {
  createProspectingFixture,
  readProspectingTestConfig,
} from "../../../tests/prospecting-fixture.js";
import { createProspectingRuntime } from "./infrastructure/prospecting-runtime.js";
import { CompanyDirectoryController } from "./presentation/company-directory.controller.js";
import { SearchCompaniesQuery } from "./application/company-directory/search-companies.query.js";
import { PROSPECTING_PORTS } from "./domain/prospecting.ports.js";
import { PrismaDirectoryRepository } from "./infrastructure/company-directory/prisma-directory.repository.js";
import { ImportCompanySnapshotWorker } from "./application/company-directory/import-company-snapshot.worker.js";
import { CnpjArchiveReader } from "./infrastructure/company-directory/cnpj-archive-reader.js";

function environment(databaseUrl: string) {
  const g = readProspectingTestConfig();
  return {
    PROSPECTING_ENABLED: "true",
    PROSPECTING_RUN_WORKERS: "true",
    PROSPECTING_DATABASE_URL: databaseUrl,
    PROSPECTING_DIRECTORY_DATABASE_URL: databaseUrl,
    PROSPECTING_NEO4J_READ_URI: g.neo4jUri,
    PROSPECTING_NEO4J_INGEST_URI: g.neo4jUri,
    PROSPECTING_NEO4J_READ_USER: g.neo4jUser,
    PROSPECTING_NEO4J_READ_PASSWORD: g.neo4jPassword,
    PROSPECTING_NEO4J_INGEST_USER: g.neo4jUser,
    PROSPECTING_NEO4J_INGEST_PASSWORD: g.neo4jPassword,
    PROSPECTING_SUPPRESSION_HMAC_KEY: "a".repeat(64),
    PROSPECTING_CURSOR_HMAC_KEY: randomBytes(32).toString("hex"),
    PROSPECTING_PROPOSAL_SECRET: randomBytes(32).toString("hex"),
    PROSPECTING_PROPOSAL_TTL_SECONDS: "3600",
    PROSPECTING_DASHBOARD_ORIGIN: "https://127.0.0.1:5180",
    PROSPECTING_PUBLIC_SITE_URL: "https://127.0.0.1:5181/zyon",
  };
}

async function withRuntime(
  check: (
    ctx: Awaited<ReturnType<typeof createProspectingFixture>>,
    runtime: ReturnType<typeof createProspectingRuntime>
  ) => Promise<void>
) {
  const f = await createCampaignFixture();
  try {
    const runtime = createProspectingRuntime(environment(f.databaseUrl));
    try {
      const http = await createProspectingFixture({
        controllers: [CompanyDirectoryController],
        providers: [
          { provide: PROSPECTING_PORTS.directory, useValue: runtime.directory },
          { provide: SearchCompaniesQuery, useValue: runtime.search },
        ],
      });
      try {
        await check(http, runtime);
      } finally {
        await http.close();
      }
    } finally {
      await runtime.onModuleDestroy();
    }
  } finally {
    await f.close();
  }
}
test("PROS-01 AC1 rejeita credencial de lojista na consulta do diretório", async () =>
  withRuntime(async (http) => {
    const response = await fetch(
      http.url + "/v1/platform/prospecting/companies",
      { headers: { Authorization: "Bearer merchant-token" } }
    );
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /Maçã|12ABC345/);
  }));
test("PROS-01 AC2 nega acesso sem permissão e mantém reservas intactas", async () =>
  withRuntime(async (http, runtime) => {
    const response = await fetch(
      http.url + "/v1/platform/prospecting/companies",
      { headers: { Authorization: "Bearer " + http.operators.billing.token } }
    );
    assert.equal(response.status, 403);
    assert.equal(await runtime.db.outreachAttempt.count(), 0);
  }));
test("PROS-32 AC1 usa dados persistidos e mantém as reservas desligadas", async () =>
  withRuntime(async (http, runtime) => {
    const response = await fetch(
      http.url + "/v1/platform/prospecting/companies",
      { headers: { Authorization: "Bearer " + http.operators.admin.token } }
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).count, 3);
    const status = await runtime.status.readiness();
    assert.equal(status.knowledge.status, "current");
    assert.equal(status.source.value?.snapshotId, "search-old");
    const before = await runtime.db.campaignRecipient.findFirstOrThrow();
    assert.equal(before.state, "pending");
    await runtime.tick();
    assert.deepEqual(
      await runtime.db.campaignRecipient.findUniqueOrThrow({
        where: { id: before.id },
      }),
      before
    );
    assert.equal(
      await runtime.inbox.accept({
        appId: "app",
        wabaId: "waba",
        phoneNumberId: "phone",
        value: {
          messages: [
            {
              id: "local-worker-handoff",
              type: "text",
              from: "5511999999999",
              timestamp: String(Math.floor(Date.now() / 1000)),
              text: { body: "Tenho uma pergunta comercial." },
            },
          ],
        },
      }),
      true
    );
    await runtime.tick();
    const message = await runtime.db.prospectMessage.findFirstOrThrow({
      where: { providerId: "local-worker-handoff" },
      include: { conversation: true },
    });
    assert.equal(message.conversation.mode, "human");
    assert.equal(
      (
        await runtime.db.prospectAuditEvent.findFirstOrThrow({
          where: {
            action: "sales.handoff",
            resourceId: message.conversationId,
          },
        })
      ).outcome,
      "model_disabled"
    );
    assert.equal(
      await runtime.db.prospectMessage.count({
        where: { direction: "outbound" },
      }),
      0
    );
    assert.equal(await runtime.db.outreachAttempt.count(), 0);
    assert.equal(await runtime.db.prospectModelUsage.count(), 0);
    assert.equal(await runtime.db.prospectCampaignDailyUsage.count(), 0);
  }));
test("PROS-32 AC1 limita bytes agregados e retoma do checkpoint com um novo limite", async () => {
  const f = await createCompanyDirectoryFixture();
  try {
    const repo = new PrismaDirectoryRepository(f.client);
    const job = await repo.saveManifest(fixtureManifest());
    const names = Array.from(
      { length: 6 },
      (_, i) => "Nome " + i + " " + "Á".repeat(1000)
    );
    const reader = new CnpjArchiveReader(
      {
        openResource: async (url) => {
          const f = /Empresas/.test(url)
            ? "empresas"
            : /Estabelecimentos/.test(url)
            ? "estabelecimentos"
            : /Simples/.test(url)
            ? "simples"
            : /Cnaes/.test(url)
            ? "cnaes"
            : /Municipios/.test(url)
            ? "municipios"
            : "naturezas";
          const rows =
            f === "empresas"
              ? names
                  .map((name, i) =>
                    csv([
                      i === 0 ? "12ABC345" : String(i).padStart(8, "0"),
                      name,
                      "2062",
                      "49",
                      "10,19",
                      "01",
                      "",
                    ])
                  )
                  .join("\n")
              : fixtureSourceRows(f);
          return new Response(companyDirectoryZip(Buffer.from(rows, "latin1")));
        },
      },
      directoryArchiveLimits
    );
    const cfg = {
      ingestionEnabled: true,
      importBatchSize: 100,
      importMaximumMemoryBytes: 10240,
    };
    assert.throws(
      () =>
        new ImportCompanySnapshotWorker(repo, reader, {
          ...cfg,
          importMaximumMemoryBytes: 16,
        }),
      /config_invalid/
    );
    const interrupted = {
      async prepare(resource: Parameters<typeof reader.prepare>[0]) {
        const archive = await reader.prepare(resource);
        return {
          ...archive,
          async *rows() {
            let n = 0;
            for await (const row of archive.rows()) {
              yield row;
              if (++n === 5 && resource.family === "empresas")
                throw Error("controlled_stop");
            }
          },
        };
      },
    };
    await assert.rejects(
      new ImportCompanySnapshotWorker(repo, interrupted, cfg).run(job.id),
      /controlled_stop/
    );
    const first = await f.client.companyImportCheckpoint.findMany({
      where: { file: { snapshotId: job.id } },
      orderBy: { batchIndex: "asc" },
    });
    assert.ok(first.length >= 1);
    assert.ok(first.every((c) => c.committedCount < 5));
    const finished = await new ImportCompanySnapshotWorker(repo, reader, {
      ...cfg,
      importMaximumMemoryBytes: 17000,
    }).run(job.id);
    assert.equal(finished.state, "published");
    const entities = await f.client.companyEntity.findMany({
      where: { snapshotId: job.id },
      select: { legalName: true },
    });
    assert.deepEqual(
      entities.map((e) => e.legalName).sort(),
      [...names].sort()
    );
    for (const c of first)
      assert.deepEqual(
        await f.client.companyImportCheckpoint.findUniqueOrThrow({
          where: {
            fileId_batchIndex: { fileId: c.fileId, batchIndex: c.batchIndex },
          },
        }),
        c
      );
  } finally {
    await f.close();
  }
});

test("PROS-32 AC1 o AppModule injeta atribuição nos dois ingressos financeiros e encerra os consumidores", async () => {
  const f = await createCampaignFixture();
  try {
    const g = readProspectingTestConfig();
    const env: NodeJS.ProcessEnv = {
      ...environment(f.databaseUrl),
      DATABASE_URL: f.databaseUrl,
      REDIS_URL: g.redisUrl,
      BILLING_TRIAL_QUEUE_REQUIRED: "false",
      AACP_PII_ENC_KEY: "local-synthetic-app-key",
      AACP_PAYMENT_ENC_KEY: "local-only-payment",
      NODE_ENV: "test",
      JWT_SECRET: randomBytes(48).toString("hex"),
      PLATFORM_CONTROL_JWT_SECRET: randomBytes(48).toString("hex"),
      LOCAL_LLM_API_KEY: "local-synthetic",
      LOCAL_LLM_MODEL: "local-synthetic",
      LOCAL_LLM_BASE_URL: "http://127.0.0.1:3019",
    };
    for (const key of [
      "SystemRoot",
      "SYSTEMROOT",
      "PATH",
      "Path",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "HOME",
      "LOCALAPPDATA",
      "APPDATA",
    ])
      if (process.env[key]) env[key] = process.env[key];
    const cwd = fileURLToPath(new URL("../../../../../", import.meta.url));
    const child = spawn(
      process.execPath,
      [
        "--loader",
        "./apps/api/tests/platform-support-loader.mjs",
        "./apps/api/tests/prospecting-root-composition.ts",
      ],
      { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    child.stdout.on("data", (s) => (output += s));
    child.stderr.on("data", (s) => (output += s));
    const timer = setTimeout(() => child.kill(), 720000);
    try {
      const exit = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      assert.equal(exit, 0, output.slice(-5000));
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await f.close();
  }
});
