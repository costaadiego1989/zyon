import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CreateInstallationUseCase,
  GetInstallationUseCase,
  ReportInstallationHealthUseCase,
  ResolveInstallationForEmbedUseCase,
} from "./installation.use-cases.js";
import type {
  CreateInstallationInput,
  InstallationRepository,
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
});

class InMemoryInstallationRepository implements InstallationRepository {
  private readonly rows = new Map<string, MerchantInstallation>();
  private sequence = 0;

  async list(merchantId: string): Promise<MerchantInstallation[]> {
    return Array.from(this.rows.values()).filter(
      (row) => row.merchantId === merchantId,
    );
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
