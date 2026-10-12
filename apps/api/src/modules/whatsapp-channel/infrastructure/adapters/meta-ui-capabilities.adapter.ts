import { Inject, Injectable } from "@nestjs/common";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../domain/services/connected-meta-cloud-credentials.js";

export interface MetaUiCapabilities { catalogId?: string; catalogRetailerIds: Record<string, string>; flowIds: Record<string, string>; checkedAt: number }

/** Optional native surfaces are discovered on this merchant's WABA only. */
@Injectable()
export class MetaUiCapabilitiesAdapter {
  private readonly cache = new Map<string, Promise<MetaUiCapabilities>>();
  private readonly expires = new Map<string, number>();
  constructor(@Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository) {}

  async get(merchantId: string, deviceId: string): Promise<MetaUiCapabilities> {
    const config = deviceId.startsWith("META_CLOUD:") ? await this.configs.findById(deviceId.slice(11)) : await this.configs.findByDeviceId(deviceId);
    const credentials = connectedMetaCloudCredentials(config, merchantId);
    if (!credentials) return { catalogRetailerIds: {}, flowIds: {}, checkedAt: Date.now() };
    const key = `${merchantId}:${config!.id}:${credentials.wabaId}`;
    if ((this.expires.get(key) ?? 0) > Date.now()) return this.cache.get(key)!;
    const pending = this.discover(credentials);
    this.cache.set(key, pending); this.expires.set(key, Date.now() + 60 * 60_000);
    if (this.cache.size > 2000) { const oldest = this.cache.keys().next().value; if (oldest) { this.cache.delete(oldest); this.expires.delete(oldest); } }
    return pending;
  }

  private async discover(c: { accessToken: string; wabaId: string }): Promise<MetaUiCapabilities> {
    const result: MetaUiCapabilities = { catalogRetailerIds: {}, flowIds: {}, checkedAt: Date.now() };
    const get = async (path: string): Promise<any> => {
      try {
        const response = await fetch(`https://graph.facebook.com/v23.0/${path}`, { headers: { Authorization: `Bearer ${c.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
        return response.ok ? response.json() : {};
      } catch { return {}; }
    };
    const catalogs = await get(`${c.wabaId}/product_catalogs?fields=id&limit=2`);
    // An ambiguous catalog needs explicit configuration, not an arbitrary pick.
    if (catalogs.data?.length === 1 && /^\d+$/.test(String(catalogs.data[0].id))) {
      result.catalogId = String(catalogs.data[0].id);
      const products = await get(`${result.catalogId}/products?fields=id,retailer_id&limit=100`);
      for (const p of products.data ?? []) if (typeof p.retailer_id === "string" && p.retailer_id) result.catalogRetailerIds[p.retailer_id] = p.retailer_id;
    }
    const flows = await get(`${c.wabaId}/flows?fields=id,name,status&limit=100`);
    for (const flow of flows.data ?? []) {
      if (flow.status !== "PUBLISHED" || !/^\d+$/.test(String(flow.id))) continue;
      if (["zyon_address_v1", "zyon_registration_v1", "zyon_booking_v1"].includes(flow.name)) result.flowIds[flow.name] = String(flow.id);
    }
    return result;
  }
}
