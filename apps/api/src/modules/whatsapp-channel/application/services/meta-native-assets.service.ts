import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../domain/services/connected-meta-cloud-credentials.js";
import { metaFieldFlowJson, META_FIELD_FLOW_NAMES } from "../../domain/ui/meta-flow.js";
import { extractOptionGroups } from "../../../storefront/domain/food-options.js";

/** Optional assets are provisioned on each merchant's authorized WABA. */
@Injectable()
export class MetaNativeAssetsService {
  private readonly logger = new Logger(MetaNativeAssetsService.name);
  private readonly running = new Map<string, Promise<void>>();
  private readonly nextAttempt = new Map<string, number>();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository) {}

  enqueue(merchantId: string, configId: string) {
    if (process.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION === "false") return;
    const key = `${merchantId}:${configId}`;
    if (this.running.has(key) || (this.nextAttempt.get(key) ?? 0) > Date.now()) return;
    this.nextAttempt.set(key, Date.now() + 3600_000);
    if (this.nextAttempt.size > 2000) this.nextAttempt.delete(this.nextAttempt.keys().next().value!);
    const pending = this.ensure(merchantId, configId).catch(() => this.logger.warn("whatsapp_native_assets_setup_deferred"))
      .finally(() => this.running.delete(key));
    this.running.set(key, pending);
  }

  async ensure(merchantId: string, configId: string): Promise<void> {
    const config = await this.configs.findById(configId);
    const credentials = connectedMetaCloudCredentials(config, merchantId);
    if (!credentials) return;
    const graph = async (path: string, init?: RequestInit) => {
      const response = await fetch(`https://graph.facebook.com/v23.0/${path}`, { ...init,
        headers: { Authorization: `Bearer ${credentials.accessToken}`, ...init?.headers }, redirect: "error", signal: AbortSignal.timeout(8000) });
      const data = await response.json().catch(() => ({})) as any;
      if (!response.ok) throw new Error(`meta_native_http_${response.status}_code_${Number(data.error?.code) || 0}`);
      return data;
    };
    await this.prisma.$transaction(async tx => {
      const locks = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`${credentials.wabaId}:native_assets`}, 0)) AS locked`);
      if (!locks[0]?.locked) return;
      const flows: any[] = []; let after: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await graph(`${credentials.wabaId}/flows?fields=id,name,status&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        flows.push(...(result.data ?? []));
        if (!result.paging?.next) break;
        after = result.paging?.cursors?.after;
        if (!after || page === 9) throw new Error("meta_native_flow_listing_incomplete");
      }
      for (const [purpose, name] of Object.entries(META_FIELD_FLOW_NAMES)) {
        const json = JSON.stringify(metaFieldFlowJson(purpose === "address"));
        const hash = createHash("sha256").update(json).digest("hex");
        // Persist provider intent outside the lock transaction. A process crash
        // must retain the uncertain create even if the advisory lock rolls back.
        let row = await this.prisma.whatsAppNativeAsset.upsert({ where: { configId_kind_name: { configId, kind: "flow", name } },
          create: { merchantId, configId, kind: "flow", name, sourceHash: hash }, update: {} });
        // A new schema may repair a known draft. Reuse its ID and keep unknown
        // creations held; a schema upgrade never authorizes a second create.
        if (row.providerId && row.sourceHash !== hash && ["draft", "unavailable"].includes(row.status)) {
          row = await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id },
            data: { sourceHash: hash, status: "draft", retryAfter: null, lastError: null } });
        }
        if (row.merchantId !== merchantId || row.sourceHash !== hash) throw new Error("meta_native_asset_version_mismatch");
        if (row.retryAfter && row.retryAfter > new Date()) continue;
        const found = flows.filter(f => f.name === name);
        if (found.length > 1) { await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { status: "unavailable", lastError: "flow_name_ambiguous", retryAfter: new Date(Date.now() + 86400_000) } }); continue; }
        let id = row.providerId ?? (found[0]?.id ? String(found[0].id) : undefined);
        try {
          // An unknown create must first be reconciled by the complete WABA list.
          if (!id && ["creating", "create_unknown"].includes(row.status)) {
            await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { retryAfter: new Date(Date.now() + 3600_000) } }); continue;
          }
          if (!id) {
            await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { status: "creating" } });
            const created = await graph(`${credentials.wabaId}/flows`, { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, categories: [purpose === "address" ? "OTHER" : "SIGN_UP"] }) });
            if (!/^\d+$/.test(String(created.id))) throw new Error("meta_native_create_unknown");
            id = String(created.id);
            row = await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { providerId: id, status: "draft" } });
          }
          if (found[0]?.status !== "PUBLISHED") {
            const form = new FormData(); form.set("name", "flow.json"); form.set("asset_type", "FLOW_JSON"); form.set("file", new Blob([json], { type: "application/json" }), "flow.json");
            const uploaded = await graph(`${id}/assets`, { method: "POST", body: form });
            if (uploaded.validation_errors?.length) throw new Error("meta_native_flow_validation_failed");
            const published = await graph(`${id}/publish`, { method: "POST" });
            if (published.success !== true) throw new Error("meta_native_publish_unknown");
          }
          await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { providerId: id, status: "published", lastError: null, retryAfter: null } });
        } catch (error) {
          const code = error instanceof Error ? error.message : "meta_native_unknown";
          const uncertain = !id && !/^meta_native_http_4/.test(code);
          await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { providerId: id, status: uncertain ? "create_unknown" : "unavailable",
            lastError: /^meta_native_[a-z0-9_]+$/.test(code) ? code : "meta_native_transport_failed", retryAfter: new Date(Date.now() + 3600_000) } });
        }
      }
    }, { timeout: 90_000, maxWait: 5000 });
    await this.syncLinkedCatalog(merchantId, configId, credentials.wabaId, graph);
  }

  private async syncLinkedCatalog(merchantId: string, configId: string, wabaId: string, graph: (path: string, init?: RequestInit) => Promise<any>) {
    const catalogs = await graph(`${wabaId}/product_catalogs?fields=id&limit=2`);
    const catalogId = catalogs.data?.length === 1 ? String(catalogs.data[0].id) : undefined;
    const root = await this.prisma.whatsAppNativeAsset.upsert({ where: { configId_kind_name: { configId, kind: "catalog", name: "storefront" } },
      create: { merchantId, configId, kind: "catalog", name: "storefront", sourceHash: "v1" }, update: {} });
    if (!catalogId || !/^\d+$/.test(catalogId)) {
      await this.prisma.whatsAppNativeAsset.update({ where: { id: root.id }, data: { status: "unavailable", lastError: catalogId ? "catalog_ambiguous" : "catalog_not_linked" } }); return;
    }
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true, storeSlug: true } });
    if (!merchant?.storeSlug) return;
    await this.prisma.whatsAppNativeAsset.update({ where: { id: root.id }, data: { status: "syncing", providerId: catalogId, lastError: null } });
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const variants = await this.prisma.productVariant.findMany({ where: { isActive: true, product: { merchantId, isActive: true, type: "physical" } },
        include: { product: true, price: true, stock: true, media: { where: { type: "IMAGE" }, orderBy: { order: "asc" }, take: 1 } },
        orderBy: { id: "asc" }, take: 50, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      for (const variant of variants) {
        if (!variant.price || variant.price.currency !== "BRL" || variant.price.basePriceInCents <= 0 || !variant.media[0]?.url?.startsWith("https://") || extractOptionGroups(variant.product.metadata).length) continue;
        const quantity = variant.stock.reduce((n, s) => n + Math.max(0, s.quantity - s.reserved), 0);
        const key = { configId, kind: "catalog_product", name: variant.id };
        const row = await this.prisma.whatsAppNativeAsset.upsert({ where: { configId_kind_name: key }, create: { ...key, merchantId, sourceHash: "pending" }, update: {} });
        const price = `price:${variant.price.basePriceInCents}`;
        if (row.status === "published" && row.sourceHash === price && row.retryAfter && row.retryAfter > new Date()) continue;
        try {
          // Variant IDs are immutable and scoped by the catalog/WABA. Upsert is
          // safe after an uncertain request and never uses buyer-supplied prices.
          const result = await graph(`${catalogId}/products`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            retailer_id: variant.id, name: variant.product.name, description: variant.product.description || variant.product.name,
            brand: merchant.name, currency: "BRL", price: variant.price.basePriceInCents, availability: quantity > 0 ? "in stock" : "out of stock", inventory: quantity,
            condition: "new", image_url: variant.media[0].url, url: `https://storefront.zyon-payments.com.br/store/${encodeURIComponent(merchant.storeSlug)}`,
            allow_upsert: true,
          }) });
          if (!result.id) throw new Error("meta_native_catalog_upsert_unknown");
          await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { status: "published", providerId: String(result.id), sourceHash: price, lastError: null, retryAfter: new Date(Date.now() + 3600_000) } });
        } catch (error) {
          const code = error instanceof Error && /^meta_native_[a-z0-9_]+$/.test(error.message) ? error.message : "meta_native_catalog_unknown";
          await this.prisma.whatsAppNativeAsset.update({ where: { id: row.id }, data: { status: "unavailable", lastError: code, retryAfter: new Date(Date.now() + 3600_000) } });
          await this.prisma.whatsAppNativeAsset.update({ where: { id: root.id }, data: { status: "unavailable", lastError: code } }); return;
        }
      }
      if (variants.length < 50) break;
      cursor = variants.at(-1)!.id;
      if (page === 99) throw new Error("meta_native_catalog_sync_limit");
    }
    await this.prisma.whatsAppNativeAsset.update({ where: { id: root.id }, data: { status: "published", lastError: null } });
  }
}
