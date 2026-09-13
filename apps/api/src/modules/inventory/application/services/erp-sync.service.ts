import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ErpConnection, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { AppliedInventorySale } from "../../domain/events/sale-completed.event.js";
import { decryptErpSecret, encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

type SupportedErp = "omie" | "bling" | "tiny";
type SyncKind = "full" | "sale";

type RemoteSnapshot = {
  externalProductId: string;
  externalLocationId: string;
  sku: string;
  productName: string;
  quantity: number;
  costCents?: number;
  salePriceCents?: number;
};

type SaleJobPayload = { receiptId: string };

const SUPPORTED = new Set<SupportedErp>(["omie", "bling", "tiny"]);
const RETRY_LIMIT = 6;
const JOB_LEASE_MS = 15 * 60_000;
const JOB_LEASE_HEARTBEAT_MS = 2 * 60_000;

function isSupported(provider: string): provider is SupportedErp {
  return SUPPORTED.has(provider as SupportedErp);
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("erp_") ? message.slice(0, 160) : "erp_sync_failed";
}

function positiveInteger(value: unknown, code: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(code);
  return result;
}

function cents(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

function dateBr(date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function dateTiny(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function externalId(value: unknown, code: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(code);
  return result;
}

/**
 * The database is the queue authority. Redis is intentionally not required:
 * claiming uses an expiring lease, so a restart can resume work without two
 * API replicas executing the same active job.
 */
@Injectable()
export class ErpSyncService {
  private readonly logger = new Logger(ErpSyncService.name);
  private draining = false;

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async enqueueFull(merchantId: string, connectionId: string, source: "manual" | "initial" | "periodic" = "manual") {
    const connection = await this.prisma.erpConnection.findFirst({ where: { id: connectionId, merchantId } });
    if (!connection) throw new Error("erp_connection_not_found");
    if (!isSupported(connection.provider)) throw new Error("erp_provider_not_supported");
    if (connection.status !== "connected") throw new Error("erp_connection_not_connected");

    const bucket = source === "periodic" ? Math.floor(Date.now() / (15 * 60 * 1000)) : Date.now();
    const job = await this.createJob({
      merchantId,
      connectionId,
      kind: "full",
      dedupeKey: `${source}:full:${connectionId}:${bucket}`,
    });
    this.kick();
    return job;
  }

  async enqueueSale(sale: AppliedInventorySale): Promise<void> {
    const connections = await this.prisma.erpConnection.findMany({
      where: {
        merchantId: sale.event.merchantId,
        status: "connected",
        provider: { in: [...SUPPORTED] },
        directionMode: { in: ["bidirectional", "zyon_source_of_truth"] },
      },
      select: { id: true },
    });

    await Promise.all(connections.map((connection) => this.createJob({
      merchantId: sale.event.merchantId,
      connectionId: connection.id,
      kind: "sale",
      dedupeKey: `sale:${connection.id}:${sale.receiptId}`,
      payload: { receiptId: sale.receiptId },
    })));
    this.kick();
  }

  async enqueuePeriodic(): Promise<void> {
    const connections = await this.prisma.erpConnection.findMany({
      where: { status: "connected", provider: { in: [...SUPPORTED] }, directionMode: { not: "zyon_source_of_truth" } },
      select: { id: true, merchantId: true },
    });
    await Promise.all(connections.map((connection) =>
      this.enqueueFull(connection.merchantId, connection.id, "periodic").catch((error) => {
        this.logger.warn("erp.periodic.enqueue_failed", { connectionId: connection.id, code: errorCode(error) });
      }),
    ));
  }

  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (true) {
        const now = new Date();
        await this.requeueExpiredLeases(now);
        const jobs = await this.prisma.erpSyncJob.findMany({
          where: {
            status: "queued",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          orderBy: { createdAt: "asc" },
          take: 10,
        });
        if (jobs.length === 0) return;
        for (const job of jobs) await this.process(job.id);
      }
    } finally {
      this.draining = false;
    }
  }

  private kick(): void {
    void this.drain().catch((error) => this.logger.error("erp.queue.drain_failed", { code: errorCode(error) }));
  }

  private async createJob(input: {
    merchantId: string;
    connectionId: string;
    kind: SyncKind;
    dedupeKey: string;
    payload?: SaleJobPayload;
  }) {
    try {
      return await this.prisma.erpSyncJob.create({
        data: { ...input, status: "queued" },
      });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const existing = await this.prisma.erpSyncJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (!existing) throw error;
      return existing;
    }
  }

  private async process(jobId: string): Promise<void> {
    const claimedAt = new Date();
    const claimed = await this.prisma.erpSyncJob.updateMany({
      where: { id: jobId, status: "queued" },
      data: { status: "running", startedAt: claimedAt, lockedUntil: new Date(claimedAt.getTime() + JOB_LEASE_MS) },
    });
    if (claimed.count !== 1) return;

    const job = await this.prisma.erpSyncJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    const heartbeat = setInterval(() => {
      void this.prisma.erpSyncJob.updateMany({
        where: { id: job.id, status: "running" },
        data: { lockedUntil: new Date(Date.now() + JOB_LEASE_MS) },
      }).catch((error) => this.logger.warn("erp.job.lease_heartbeat_failed", { jobId: job.id, code: errorCode(error) }));
    }, JOB_LEASE_HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const connection = await this.prisma.erpConnection.findFirst({
        where: { id: job.connectionId, merchantId: job.merchantId, status: "connected" },
      });
      if (!connection || !isSupported(connection.provider)) throw new Error("erp_connection_not_available");

      if (job.kind === "full") {
        if (connection.directionMode !== "zyon_source_of_truth") {
          const snapshots = await this.pullSnapshots(connection);
          for (const snapshot of snapshots) await this.applySnapshot(connection, snapshot);
        }
      } else if (job.kind === "sale") {
        if (connection.directionMode !== "erp_source_of_truth") {
          const payload = job.payload as SaleJobPayload | null;
          if (!payload?.receiptId) throw new Error("erp_sale_job_invalid");
          await this.pushSale(connection, job.merchantId, payload.receiptId);
        }
      } else {
        throw new Error("erp_job_kind_invalid");
      }

      await this.prisma.$transaction([
        this.prisma.erpSyncJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), lockedUntil: null, lastErrorCode: null } }),
        this.prisma.erpConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date(), lastErrorCode: null } }),
      ]);
    } catch (error) {
      const code = errorCode(error);
      const attempts = job.attempts + 1;
      const terminal = attempts >= RETRY_LIMIT || code === "erp_multi_location_requires_mapping";
      const nextAttemptAt = terminal ? null : new Date(Date.now() + Math.min(30 * 60_000, 2 ** attempts * 30_000));
      await this.prisma.$transaction([
        this.prisma.erpSyncJob.update({
          where: { id: job.id },
          data: { status: terminal ? "failed" : "queued", attempts, nextAttemptAt, lockedUntil: null, lastErrorCode: code },
        }),
        this.prisma.erpConnection.update({ where: { id: job.connectionId }, data: { lastErrorCode: code } }),
      ]);
      this.logger.warn("erp.job.failed", { jobId: job.id, connectionId: job.connectionId, attempts, code });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async requeueExpiredLeases(now: Date): Promise<void> {
    const recovered = await this.prisma.erpSyncJob.updateMany({
      where: { status: "running", lockedUntil: { lte: now } },
      data: { status: "queued", nextAttemptAt: now, lockedUntil: null, lastErrorCode: "erp_worker_lease_expired" },
    });
    if (recovered.count > 0) this.logger.warn("erp.queue.leases_recovered", { count: recovered.count });
  }

  private async pullSnapshots(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    switch (connection.provider) {
      case "omie": return this.pullOmie(connection);
      case "bling": return this.pullBling(connection);
      case "tiny": return this.pullTiny(connection);
    }
    throw new Error("erp_provider_not_supported");
  }

  private async pushSale(connection: ErpConnection, merchantId: string, receiptId: string): Promise<void> {
    const receipt = await this.prisma.inventorySaleReceipt.findFirst({ where: { id: receiptId, merchantId } });
    if (!receipt) throw new Error("erp_sale_receipt_not_found");
    const result = receipt.result as unknown as AppliedInventorySale;
    if (!Array.isArray(result?.items)) throw new Error("erp_sale_receipt_invalid");

    for (const item of result.items) {
      const mapping = await this.prisma.erpProductMapping.findFirst({
        where: { connectionId: connection.id, sku: item.sku, externalLocationId: "0" },
      });
      if (!mapping) throw new Error("erp_product_mapping_missing");
      const idempotencyKey = createHash("sha256").update(`${connection.id}:${receiptId}:${item.itemId}`).digest("hex").slice(0, 48);
      if (connection.provider === "omie") {
        await this.pushOmieSale(connection, mapping.externalProductId, item.quantity, receipt.orderId, idempotencyKey);
      } else if (connection.provider === "bling") {
        await this.pushBlingSnapshot(connection, mapping.externalProductId, item.remainingQuantity, idempotencyKey);
      } else {
        await this.pushTinySnapshot(connection, mapping.externalProductId, item.remainingQuantity, idempotencyKey);
      }
    }
  }

  private async applySnapshot(connection: ErpConnection, snapshot: RemoteSnapshot): Promise<void> {
    if (!Number.isSafeInteger(snapshot.quantity)) throw new Error("erp_fractional_stock_not_supported");
    await this.prisma.$transaction(async (tx) => {
      // Every stock writer in this module takes this merchant lock first.
      await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${connection.merchantId} FOR UPDATE`;
      const activeLocations = await tx.inventoryLocation.findMany({ where: { merchantId: connection.merchantId, isActive: true }, take: 2 });
      if (activeLocations.length > 1) throw new Error("erp_multi_location_requires_mapping");
      const location = activeLocations[0] ?? await tx.inventoryLocation.create({
        data: { merchantId: connection.merchantId, name: "Estoque principal", kind: "warehouse", isDefault: true },
      });

      const existingMapping = await tx.erpProductMapping.findFirst({
        where: { connectionId: connection.id, externalProductId: snapshot.externalProductId, externalLocationId: snapshot.externalLocationId },
      });
      let variant = existingMapping?.variantId
        ? await tx.productVariant.findUnique({ where: { id: existingMapping.variantId }, include: { product: true, stock: true, price: true } })
        : null;

      if (!variant) {
        const matches = await tx.productVariant.findMany({
          where: { sku: snapshot.sku, product: { merchantId: connection.merchantId } },
          include: { product: true, stock: true, price: true },
          take: 2,
        });
        if (matches.length > 1) throw new Error("erp_sku_ambiguous");
        variant = matches[0] ?? null;
      }

      if (!variant) {
        const product = await tx.product.create({ data: { merchantId: connection.merchantId, name: snapshot.productName, type: "physical", isActive: false } });
        variant = await tx.productVariant.create({
          data: { productId: product.id, sku: snapshot.sku },
          include: { product: true, stock: true, price: true },
        });
        await tx.productPrice.create({ data: { variantId: variant.id, basePriceInCents: snapshot.salePriceCents ?? 0, costInCents: snapshot.costCents } });
        await tx.productStock.create({ data: { variantId: variant.id, quantity: snapshot.quantity } });
        const item = await tx.inventoryItem.create({
          data: {
            merchantId: connection.merchantId, sku: snapshot.sku, productName: snapshot.productName,
            locationId: location.id, quantity: snapshot.quantity, avgCostCents: snapshot.costCents, salePriceCents: snapshot.salePriceCents,
            lastCountedAt: new Date(),
          },
        });
        if (snapshot.quantity !== 0) await tx.inventoryMovement.create({
          data: { merchantId: connection.merchantId, itemId: item.id, kind: "ENTRY", quantity: snapshot.quantity, reason: "Importação ERP", source: `erp:${connection.provider}` },
        });
      } else {
        const stocks = variant.stock;
        if (stocks.length > 1) throw new Error("erp_catalog_stock_ambiguous");
        const stock = stocks[0] ?? await tx.productStock.create({ data: { variantId: variant.id, quantity: 0 } });
        const item = await tx.inventoryItem.findFirst({ where: { merchantId: connection.merchantId, sku: variant.sku, locationId: location.id } });
        if (stock.reserved > snapshot.quantity || (item?.reserved ?? 0) > snapshot.quantity) throw new Error("erp_quantity_below_reserved");
        const delta = snapshot.quantity - (item?.quantity ?? stock.quantity);
        await tx.product.update({ where: { id: variant.productId }, data: { name: snapshot.productName } });
        await tx.productStock.update({ where: { id: stock.id }, data: { quantity: snapshot.quantity } });
        await tx.productPrice.upsert({
          where: { variantId: variant.id },
          update: { basePriceInCents: snapshot.salePriceCents ?? variant.price?.basePriceInCents ?? 0, costInCents: snapshot.costCents ?? variant.price?.costInCents },
          create: { variantId: variant.id, basePriceInCents: snapshot.salePriceCents ?? 0, costInCents: snapshot.costCents },
        });
        if (item) {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: snapshot.quantity, productName: snapshot.productName, avgCostCents: snapshot.costCents, salePriceCents: snapshot.salePriceCents, lastCountedAt: new Date() } });
          if (delta !== 0) await tx.inventoryMovement.create({
            data: { merchantId: connection.merchantId, itemId: item.id, kind: delta > 0 ? "ENTRY" : "ADJUSTMENT", quantity: delta, reason: "Snapshot ERP", source: `erp:${connection.provider}` },
          });
        } else {
          await tx.inventoryItem.create({ data: { merchantId: connection.merchantId, sku: variant.sku, productName: snapshot.productName, locationId: location.id, quantity: snapshot.quantity, avgCostCents: snapshot.costCents, salePriceCents: snapshot.salePriceCents, lastCountedAt: new Date() } });
        }
      }

      const mappedVariant = variant!;
      const mappingData = { merchantId: connection.merchantId, connectionId: connection.id, variantId: mappedVariant.id, sku: mappedVariant.sku, externalProductId: snapshot.externalProductId, externalLocationId: snapshot.externalLocationId };
      if (existingMapping) await tx.erpProductMapping.update({ where: { id: existingMapping.id }, data: mappingData });
      else await tx.erpProductMapping.create({ data: mappingData });
    });
  }

  private async pullOmie(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    const credentials = this.omieCredentials(connection);
    const snapshots: RemoteSnapshot[] = [];
    for (let page = 1; ; page++) {
      const response = await this.omieCall("https://app.omie.com.br/api/v1/estoque/consulta/", credentials, "ListarPosEstoque", {
        nPagina: page, nRegPorPagina: 100, dDataPosicao: dateBr(), codigo_local_estoque: 0,
      });
      const rows = Array.isArray(response.produtos) ? response.produtos : [];
      for (const row of rows) snapshots.push({
        externalProductId: externalId(row.nCodProd, "erp_omie_product_id_missing"), externalLocationId: "0",
        sku: externalId(row.cCodigo, "erp_omie_product_code_missing"), productName: externalId(row.cDescricao, "erp_omie_product_name_missing"),
        quantity: positiveInteger(row.nSaldo, "erp_fractional_stock_not_supported"), costCents: cents(row.nCMC), salePriceCents: cents(row.nPrecoUnitario),
      });
      const totalPages = Number(response.nTotPaginas ?? response.total_de_paginas ?? 1);
      if (page >= totalPages || rows.length === 0) break;
    }
    return snapshots;
  }

  private async pushOmieSale(connection: ErpConnection, productId: string, quantity: number, orderId: string, idempotencyKey: string): Promise<void> {
    const numericId = positiveInteger(productId, "erp_omie_product_id_invalid");
    await this.omieCall("https://app.omie.com.br/api/v1/estoque/ajuste/", this.omieCredentials(connection), "IncluirAjusteEstoque", {
      id_prod: numericId, cod_int_ajuste: idempotencyKey, data: dateBr(), tipo: "SAI", quan: quantity,
      origem: "AJU", motivo: "INV", obs: `Venda Zyon ${orderId}`.slice(0, 200),
    });
  }

  private omieCredentials(connection: ErpConnection): { appKey: string; appSecret: string } {
    if (!connection.accessTokenCipher || !connection.refreshTokenCipher) throw new Error("erp_omie_credentials_missing");
    return { appKey: decryptErpSecret(connection.accessTokenCipher), appSecret: decryptErpSecret(connection.refreshTokenCipher) };
  }

  private async omieCall(url: string, credentials: { appKey: string; appSecret: string }, call: string, param: Record<string, unknown>): Promise<any> {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ call, app_key: credentials.appKey, app_secret: credentials.appSecret, param: [param] }) });
    if (!response.ok) throw new Error(`erp_omie_http_${response.status}`);
    const body = await response.json() as any;
    if (body.faultstring || (body.status && body.status !== "OK")) throw new Error("erp_omie_api_error");
    return body;
  }

  private async pullBling(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    const token = await this.blingToken(connection);
    const snapshots: RemoteSnapshot[] = [];
    for (let page = 1; page <= 10_000; page++) {
      const listing = await this.blingFetch(token, `/produtos?pagina=${page}&limite=100`);
      const rows = Array.isArray(listing.data) ? listing.data : [];
      for (const row of rows) {
        const id = externalId(row.id, "erp_bling_product_id_missing");
        const detail = await this.blingFetch(token, `/produtos/${encodeURIComponent(id)}`);
        const product = detail.data ?? detail;
        const stock = product.estoque ?? product.stock ?? product;
        const quantity = stock.saldoFisicoTotal ?? stock.saldoFisico ?? product.saldoFisicoTotal;
        snapshots.push({
          externalProductId: id, externalLocationId: "0", sku: externalId(product.codigo ?? row.codigo ?? id, "erp_bling_product_code_missing"),
          productName: externalId(product.nome ?? row.nome, "erp_bling_product_name_missing"),
          quantity: positiveInteger(quantity, "erp_bling_stock_shape_invalid"), costCents: cents(product.precoCusto), salePriceCents: cents(product.preco),
        });
      }
      if (rows.length < 100) break;
    }
    return snapshots;
  }

  private async pushBlingSnapshot(connection: ErpConnection, productId: string, quantity: number, idempotencyKey: string): Promise<void> {
    const token = await this.blingToken(connection);
    await this.blingFetch(token, "/estoques", {
      method: "POST",
      body: JSON.stringify({ produto: { id: positiveInteger(productId, "erp_bling_product_id_invalid") }, operacao: "B", quantidade: quantity, observacoes: `Zyon ${idempotencyKey}` }),
    });
  }

  private async blingToken(connection: ErpConnection): Promise<string> {
    if (!connection.accessTokenCipher) throw new Error("erp_bling_access_token_missing");
    if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 60_000) return decryptErpSecret(connection.accessTokenCipher);
    if (!connection.refreshTokenCipher || !process.env.BLING_CLIENT_ID || !process.env.BLING_CLIENT_SECRET) throw new Error("erp_bling_refresh_unavailable");
    const auth = Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString("base64");
    const response = await fetch("https://api.bling.com.br/Api/v3/oauth/token", {
      method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", "enable-jwt": "1" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptErpSecret(connection.refreshTokenCipher) }).toString(),
    });
    if (!response.ok) throw new Error("erp_bling_token_refresh_failed");
    const body = await response.json() as any;
    if (!body.access_token) throw new Error("erp_bling_token_refresh_failed");
    await this.prisma.erpConnection.update({ where: { id: connection.id }, data: { accessTokenCipher: encryptErpSecret(body.access_token), refreshTokenCipher: body.refresh_token ? encryptErpSecret(body.refresh_token) : connection.refreshTokenCipher, tokenExpiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000) } });
    return body.access_token;
  }

  private async blingFetch(token: string, path: string, init?: RequestInit): Promise<any> {
    const response = await fetch(`https://api.bling.com.br/Api/v3${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "enable-jwt": "1", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`erp_bling_http_${response.status}`);
    return response.json();
  }

  private async pullTiny(connection: ErpConnection): Promise<RemoteSnapshot[]> {
    const token = this.tinyToken(connection);
    const snapshots: RemoteSnapshot[] = [];
    for (let page = 1; page <= 10_000; page++) {
      const listing = await this.tinyCall("pdv.produtos.php", token, { pagina: String(page) });
      const response = listing.retorno ?? listing;
      const rows = Array.isArray(response.produtos) ? response.produtos : [];
      for (const raw of rows) {
        const row = raw.produto ?? raw;
        const id = externalId(row.id, "erp_tiny_product_id_missing");
        const detail = await this.tinyCall("produto.obter.php", token, { id });
        const product = (detail.retorno ?? detail).produto;
        const stockResult = await this.tinyCall("produto.obter.estoque.php", token, { id });
        const deposits = (stockResult.retorno ?? stockResult).produto?.depositos ?? [];
        const quantity = deposits.reduce((total: number, entry: any) => total + Number(entry.deposito?.saldo ?? entry.saldo ?? 0), 0);
        snapshots.push({
          externalProductId: id, externalLocationId: "0", sku: externalId(product.codigo ?? row.codigo ?? id, "erp_tiny_product_code_missing"),
          productName: externalId(product.nome ?? row.nome, "erp_tiny_product_name_missing"), quantity: positiveInteger(quantity, "erp_fractional_stock_not_supported"),
          costCents: cents(product.preco_custo ?? row.preco_custo), salePriceCents: cents(product.preco ?? row.preco),
        });
      }
      if (page >= Number(response.numero_paginas ?? 1) || rows.length === 0) break;
    }
    return snapshots;
  }

  private async pushTinySnapshot(connection: ErpConnection, productId: string, quantity: number, idempotencyKey: string): Promise<void> {
    await this.tinyCall("produto.atualizar.estoque.php", this.tinyToken(connection), {
      estoque: JSON.stringify({ idProduto: positiveInteger(productId, "erp_tiny_product_id_invalid"), tipo: "B", quantidade: String(quantity), data: dateTiny(), observacoes: `Zyon ${idempotencyKey}`.slice(0, 100) }),
    });
  }

  private tinyToken(connection: ErpConnection): string {
    if (!connection.accessTokenCipher) throw new Error("erp_tiny_api_token_missing");
    return decryptErpSecret(connection.accessTokenCipher);
  }

  private async tinyCall(service: string, token: string, data: Record<string, string>): Promise<any> {
    const form = new URLSearchParams({ token, formato: "JSON", ...data });
    const response = await fetch(`https://api.tiny.com.br/api2/${service}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    if (!response.ok) throw new Error(`erp_tiny_http_${response.status}`);
    const body = await response.json() as any;
    const result = body.retorno ?? body;
    if (result.status && result.status !== "OK") {
      const code = Number(result.codigo_erro);
      if (code !== 20) throw new Error("erp_tiny_api_error");
    }
    return body;
  }
}
