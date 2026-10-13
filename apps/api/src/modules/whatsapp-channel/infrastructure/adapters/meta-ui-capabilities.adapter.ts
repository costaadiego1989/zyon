import { Inject, Injectable } from "@nestjs/common";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../domain/services/connected-meta-cloud-credentials.js";
import { MetaNativeAssetsService } from "../../application/services/meta-native-assets.service.js";
import { Optional } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

export interface MetaUiCapabilities { catalogId?: string; catalogRetailerIds: Record<string, string>; catalogPrices?: Record<string, number>; flowIds: Record<string, string>; checkedAt: number }

/** Optional native surfaces are discovered on this merchant's WABA only. */
@Injectable()
export class MetaUiCapabilitiesAdapter {
  private readonly cache = new Map<string, Promise<MetaUiCapabilities>>();
  private readonly expires = new Map<string, number>();
  constructor(@Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
    @Optional() private readonly nativeAssets?: MetaNativeAssetsService,
    @Optional() @Inject(PRISMA_CLIENT) private readonly prisma?: PrismaClient) {}

  async get(merchantId: string, deviceId: string): Promise<MetaUiCapabilities> {
    const config = deviceId.startsWith("META_CLOUD:") ? await this.configs.findById(deviceId.slice(11)) : await this.configs.findByDeviceId(deviceId);
    const credentials = connectedMetaCloudCredentials(config, merchantId);
    if (!credentials) return { catalogRetailerIds: {}, flowIds: {}, checkedAt: Date.now() };
    const key = `${merchantId}:${config!.id}:${credentials.wabaId}`;
    if ((this.expires.get(key) ?? 0) > Date.now()) return this.cache.get(key)!;
    const pending = this.discover(credentials).then(result => {
      this.expires.set(key, Date.now() + (Object.keys(result.flowIds).length >= 2 ? 60 : 1) * 60_000);
      if (Object.keys(result.flowIds).length < 2) this.nativeAssets?.enqueue(merchantId, config!.id);
      return result;
    });
    if (this.nativeAssets) this.nativeAssets.enqueue(merchantId, config!.id);
    this.cache.set(key, pending); this.expires.set(key, Date.now() + 60_000);
    if (this.cache.size > 2000) { const oldest = this.cache.keys().next().value; if (oldest) { this.cache.delete(oldest); this.expires.delete(oldest); } }
    const result = await pending;
    if (result.catalogId && this.prisma) {
      const synced = await this.prisma.whatsAppNativeAsset.findMany({ where: { merchantId, configId: config!.id, kind: "catalog_product", status: "published", retryAfter: { gt: new Date() } }, select: { name: true, sourceHash: true } });
      result.catalogPrices = Object.fromEntries(synced.flatMap(row => /^price:\d+$/.test(row.sourceHash) ? [[row.name, Number(row.sourceHash.slice(6))]] : []));
      if (!synced.length) this.expires.set(key, Date.now() + 60_000);
    }
    return result;
  }

  private async discover(c: { accessToken: string; wabaId: string }): Promise<MetaUiCapabilities> {
    const result: MetaUiCapabilities = { catalogRetailerIds: {}, flowIds: {}, checkedAt: Date.now() };
    const get = async (path: string): Promise<any> => {
      try {
        const response = await fetch(`https://graph.facebook.com/v23.0/${path}`, { headers: { Authorization: `Bearer ${c.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
        return response.ok ? response.json() : {};
      } catch { return {}; }
    };
    const [catalogs, flows] = await Promise.all([get(`${c.wabaId}/product_catalogs?fields=id&limit=2`), get(`${c.wabaId}/flows?fields=id,name,status&limit=100`)]);
    // An ambiguous catalog needs explicit configuration, not an arbitrary pick.
    if (catalogs.data?.length === 1 && /^\d+$/.test(String(catalogs.data[0].id))) {
      result.catalogId = String(catalogs.data[0].id);
      let after: string | undefined;
      for (let page = 0; page < 10; page++) {
        const products = await get(`${result.catalogId}/products?fields=id,retailer_id&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
        for (const p of products.data ?? []) if (typeof p.retailer_id === "string" && p.retailer_id) result.catalogRetailerIds[p.retailer_id] = p.retailer_id;
        if (!products.paging?.next || !products.paging?.cursors?.after) break;
        after = products.paging.cursors.after;
      }
    }
    for (const flow of flows.data ?? []) {
      if (flow.status !== "PUBLISHED" || !/^\d+$/.test(String(flow.id))) continue;
      if (["zyon_address_v1", "zyon_registration_v1", "zyon_booking_v1"].includes(flow.name)) result.flowIds[flow.name] = String(flow.id);
    }
    return result;
  }
}
