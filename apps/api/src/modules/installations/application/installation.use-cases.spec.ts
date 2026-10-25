import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CreateInstallationUseCase,
  GetInstallationUseCase,
  ListInstallationsUseCase,
  ReportInstallationHealthUseCase,
  ResolveInstallationForEmbedUseCase,
} from "./installation.use-cases.js";
import type {
  CreateInstallationInput,
  InstallationRepository,
  ListInstallationsInput,
  ListInstallationsResult,
  MerchantInstallation,
  ReportInstallationHealthInput,
  UpdateInstallationInput,
} from "../domain/ports/installation-repository.port.js";

describe("merchant installations", () => {
  it("normalizes origins and keeps installations tenant-scoped", async () => {
    const repository = new InMemoryInstallationRepository();
    const create = new CreateInstallationUseCase(repository);
    const get = new GetInstallationUseCase(repository);

    const installation = await create.execute({
      merchantId: "mrc_a",
      name: "Storefront principal",
      environment: "test",
      widgetVersion: "1.0.0",
      allowedOrigins: [
        "https://shop.example/checkout",
        "https://shop.example",
      ],
    });

    assert.deepEqual(installation.allowedOrigins, ["https://shop.example"]);
    await assert.rejects(
      get.execute("mrc_b", installation.id),
      /installation_not_found/,
    );
  });

  it("forbids insecure origins for live installations", async () => {
    const create = new CreateInstallationUseCase(
      new InMemoryInstallationRepository(),
    );

    assert.throws(
      () => create.execute({
        merchantId: "mrc_a",
        name: "Production",
        environment: "live",
        widgetVersion: "1.0.0",
        allowedOrigins: ["http://localhost:3000"],
      }),
      /installation_origin_must_be_https/,
    );
  });

  it("binds embed issuance to installation origin and credential environment", async () => {
    const repository = new InMemoryInstallationRepository();
    const create = new CreateInstallationUseCase(repository);
    const resolve = new ResolveInstallationForEmbedUseCase(
      new GetInstallationUseCase(repository),
    );
    const installation = await create.execute({
      merchantId: "mrc_a",
      name: "Sandbox",
      environment: "test",
      widgetVersion: "2.4.0",
      allowedOrigins: ["https://sandbox.example"],
    });

    const resolved = await resolve.execute({
      merchantId: "mrc_a",
      installationId: installation.id,
      requestedOrigin: "https://sandbox.example/checkout",
      credentialEnvironment: "test",
    });
    assert.equal(resolved.allowedOrigin, "https://sandbox.example");

    await assert.rejects(
      resolve.execute({
        merchantId: "mrc_a",
        installationId: installation.id,
        requestedOrigin: "https://evil.example",
        credentialEnvironment: "test",
      }),
      /installation_origin_not_allowed/,
    );
    await assert.rejects(
      resolve.execute({
        merchantId: "mrc_a",
        installationId: installation.id,
        credentialEnvironment: "live",
      }),
      /installation_environment_mismatch/,
    );
  });

  it("records widget health only from an authorized origin", async () => {
    const repository = new InMemoryInstallationRepository();
    const create = new CreateInstallationUseCase(repository);
    const health = new ReportInstallationHealthUseCase(repository);
    const installation = await create.execute({
      merchantId: "mrc_a",
      name: "Health",
      environment: "test",
      widgetVersion: "1.0.0",
      allowedOrigins: ["https://shop.example"],
    });

    const degraded = await health.execute({
      merchantId: "mrc_a",
      installationId: installation.id,
      origin: "https://shop.example",
      widgetVersion: "1.0.1",
      healthy: false,
      errorCode: "widget_boot_timeout",
    });
    assert.equal(degraded.status, "degraded");
    assert.equal(degraded.lastErrorCode, "widget_boot_timeout");

    await assert.rejects(
      health.execute({
        merchantId: "mrc_a",
        installationId: installation.id,
        origin: "https://evil.example",
        widgetVersion: "1.0.1",
        healthy: true,
      }),
      /installation_origin_not_allowed/,
    );
  });

  it("list returns real cursor pagination — next_cursor is null when all rows fit, non-null when truncated", async () => {
    const repository = new InMemoryInstallationRepository();
    const create = new CreateInstallationUseCase(repository);
    const list = new ListInstallationsUseCase(repository);

    for (let i = 0; i < 5; i++) {
      await create.execute({
        merchantId: "mrc_a",
        name: `Installation ${i}`,
        environment: "test",
        widgetVersion: "1.0.0",
        allowedOrigins: ["https://shop.example"],
      });
    }

    // Full fetch: limit larger than total → no next cursor
    const full = await list.execute("mrc_a");
    assert.equal(full.hasMore, false);
    assert.equal(full.nextCursor, null);
    assert.equal(full.data.length, 5);

    // Page 1: limit=2 → hasMore, nextCursor present
    const page1 = await list.execute("mrc_a", 2);
    assert.equal(page1.hasMore, true);
    assert.ok(page1.nextCursor, "expected a next cursor");
    assert.equal(page1.data.length, 2);

    // Page 2: use cursor from page 1
    const page2 = await list.execute("mrc_a", 2, page1.nextCursor!);
    assert.equal(page2.data.length, 2);
    assert.ok(page2.nextCursor, "expected a next cursor on page 2");

    // Page 3: last page
    const page3 = await list.execute("mrc_a", 2, page2.nextCursor!);
    assert.equal(page3.data.length, 1);
    assert.equal(page3.hasMore, false);
    assert.equal(page3.nextCursor, null);

    // No cross-tenant leakage
    const other = await list.execute("mrc_b");
    assert.equal(other.data.length, 0);
  });
});

class InMemoryInstallationRepository implements InstallationRepository {
  private readonly rows = new Map<string, MerchantInstallation>();
  private sequence = 0;

  async list(input: ListInstallationsInput): Promise<ListInstallationsResult> {
    const pageSize = Math.min(input.limit ?? 50, 200);
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;

    const all = Array.from(this.rows.values())
      .filter((row) => row.merchantId === input.merchantId)
      .sort((a, b) => {
        const envCmp = a.environment.localeCompare(b.environment);
        if (envCmp !== 0) return envCmp;
        const cCmp = a.createdAt.localeCompare(b.createdAt);
        if (cCmp !== 0) return cCmp;
        return a.id.localeCompare(b.id);
      });

    const startIdx = cursor
      ? all.findIndex(
          (r) =>
            r.createdAt > cursor.createdAt ||
            (r.createdAt === cursor.createdAt && r.id > cursor.id),
        )
      : 0;
    const paged = startIdx === -1 ? [] : all.slice(startIdx, startIdx + pageSize + 1);
    const hasMore = paged.length > pageSize;
    const data = paged.slice(0, pageSize).map((r) => structuredClone(r) as MerchantInstallation);
    const last = data.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt as string, id: last.id as string }) : null;
    return { data, nextCursor, hasMore };
  }

  async get(
    merchantId: string,
    installationId: string,
  ): Promise<MerchantInstallation | undefined> {
    const row = this.rows.get(installationId);
    return row?.merchantId === merchantId ? structuredClone(row) : undefined;
  }

  async create(
    input: CreateInstallationInput,
  ): Promise<MerchantInstallation> {
    const now = new Date().toISOString();
    const row: MerchantInstallation = {
      id: `ins_${++this.sequence}`,
      merchantId: input.merchantId,
      name: input.name,
      environment: input.environment,
      status: "active",
      widgetVersion: input.widgetVersion,
      allowedOrigins: input.allowedOrigins,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }

  async update(input: UpdateInstallationInput): Promise<MerchantInstallation> {
    const current = await this.get(input.merchantId, input.installationId);
    if (!current) throw new Error("installation_not_found");
    const updated: MerchantInstallation = {
      ...current,
      ...(input.name ? { name: input.name } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.widgetVersion ? { widgetVersion: input.widgetVersion } : {}),
      ...(input.allowedOrigins
        ? { allowedOrigins: input.allowedOrigins }
        : {}),
      updatedAt: new Date(Date.now() + 1).toISOString(),
    };
    this.rows.set(updated.id, updated);
    return structuredClone(updated);
  }

  async reportHealth(
    input: ReportInstallationHealthInput,
  ): Promise<MerchantInstallation> {
    const current = await this.get(input.merchantId, input.installationId);
    if (!current) throw new Error("installation_not_found");
    const now = new Date().toISOString();
    const updated: MerchantInstallation = {
      ...current,
      status: input.healthy ? "active" : "degraded",
      widgetVersion: input.widgetVersion,
      lastHealthAt: now,
      lastSeenAt: now,
      ...(input.healthy
        ? { lastErrorCode: undefined }
        : { lastErrorCode: input.errorCode ?? "widget_unhealthy" }),
      updatedAt: now,
    };
    this.rows.set(updated.id, updated);
    return structuredClone(updated);
  }
}

type CursorRecord = { createdAt: string; id: string };

function encodeCursor(c: CursorRecord): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(value: string): CursorRecord {
  return JSON.parse(Buffer.from(value, "base64url").toString()) as CursorRecord;
}
