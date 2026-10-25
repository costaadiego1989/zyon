import { Inject, Injectable } from "@nestjs/common";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../domain/services/connected-meta-cloud-credentials.js";
import { StorefrontAttachmentInterpreter } from "../../../storefront/application/services/storefront-attachment-interpreter.service.js";

@Injectable()
export class MetaInboundMediaAdapter {
  constructor(@Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
    private readonly interpreter: StorefrontAttachmentInterpreter) {}

  async interpret(merchantId: string, deviceId: string, media: { id: string; mimeType?: string; name?: string }): Promise<string | undefined> {
    if (!/^\d+$/.test(media.id)) return undefined;
    const config = deviceId.startsWith("META_CLOUD:") ? await this.configs.findById(deviceId.slice(11)) : null;
    const credentials = connectedMetaCloudCredentials(config, merchantId);
    if (!credentials) return undefined;
    try {
      const metadata = await fetch(`https://graph.facebook.com/v23.0/${media.id}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!metadata.ok) return undefined;
      const info = await metadata.json() as { url?: string; mime_type?: string; file_size?: number };
      const mimeType = info.mime_type ?? media.mimeType;
      const image = ["image/jpeg", "image/png", "image/webp"].includes(mimeType ?? "");
      if (!image && !["text/plain", "text/csv"].includes(mimeType ?? "")) return undefined;
      const max = image ? 3 * 1024 * 1024 : 24 * 1024;
      if (!info.url || !info.file_size || info.file_size > max) return undefined;
      const url = new URL(info.url);
      if (url.protocol !== "https:" || url.username || url.password || !["lookaside.fbsbx.com", "facebook.com", "fbcdn.net"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return undefined;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${credentials.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok || !response.body) return undefined;
      const chunks: Uint8Array[] = []; let length = 0;
      for await (const chunk of response.body as any) {
        length += chunk.length; if (length > max) { await response.body.cancel().catch(() => {}); return undefined; } chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      return await this.interpreter.interpret(image ? { kind: "image", name: media.name ?? "Foto enviada pelo WhatsApp", mimeType, dataBase64: bytes.toString("base64") }
        : { kind: "shopping_list", name: media.name ?? "Lista de compras", mimeType, text: bytes.toString("utf8") });
    } catch { return undefined; }
  }
}
