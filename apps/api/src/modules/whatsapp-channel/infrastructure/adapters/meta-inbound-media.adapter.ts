import { Inject, Injectable, Optional } from "@nestjs/common";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { connectedMetaCloudCredentials } from "../../domain/services/connected-meta-cloud-credentials.js";
import { StorefrontAttachmentInterpreter } from "../../../storefront/application/services/storefront-attachment-interpreter.service.js";
import { MetaAudioTranscriptionService, MAX_META_AUDIO_BYTES, isOggOpus } from "./meta-audio-transcription.service.js";

/** Internal output only: caller MIME never grants the audio-transcript kind. */
export type MetaInboundMediaResult =
  | { kind: "attachment_context"; context: string }
  | { kind: "audio_transcript"; text: string; scope: { merchantId: string; deviceId: string; inboxId: string; conversationId: string; mediaId: string } };

@Injectable()
export class MetaInboundMediaAdapter {
  constructor(@Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
    private readonly interpreter: StorefrontAttachmentInterpreter,
    @Optional() @Inject(MetaAudioTranscriptionService) private readonly audio?: MetaAudioTranscriptionService) {}

  async interpret(merchantId: string, deviceId: string, media: { id: string; mimeType?: string; name?: string },
    context?: { inboxId: string; conversationId: string }): Promise<MetaInboundMediaResult | undefined> {
    if (!/^\d+$/.test(media.id)) return undefined;
    const config = deviceId.startsWith("META_CLOUD:") ? await this.configs.findById(deviceId.slice(11)) : null;
    const credentials = connectedMetaCloudCredentials(config, merchantId);
    if (!credentials) return undefined;
    try {
      const metadata = await fetch(`https://graph.facebook.com/v23.0/${media.id}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!metadata.ok) return undefined;
      const info = await metadata.json() as { url?: string; mime_type?: string; file_size?: number };
      const mimeType = (info.mime_type ?? media.mimeType)?.split(";")[0]?.trim().toLowerCase();
      const image = ["image/jpeg", "image/png", "image/webp"].includes(mimeType ?? "");
      const audio = mimeType === "audio/ogg";
      if ((image || audio) && (!context?.inboxId?.trim() || !context.conversationId?.trim())) return undefined;
      if (audio && (!info.mime_type || !context?.inboxId || !context.conversationId || !this.audio)) return undefined;
      if (!image && !audio && !["text/plain", "text/csv"].includes(mimeType ?? "")) return undefined;
      const max = image || audio ? MAX_META_AUDIO_BYTES : 24 * 1024;
      if (!info.url || !Number.isSafeInteger(info.file_size) || info.file_size! <= 0 || info.file_size! > max) return undefined;
      const url = new URL(info.url);
      if (url.protocol !== "https:" || url.username || url.password || !["lookaside.fbsbx.com", "facebook.com", "fbcdn.net"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return undefined;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${credentials.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok || !response.body) return undefined;
      const chunks: Uint8Array[] = []; let length = 0;
      for await (const chunk of response.body as any) {
        length += chunk.length; if (length > max) { await response.body.cancel().catch(() => {}); return undefined; } chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (audio) {
        if (bytes.length !== info.file_size || !isOggOpus(bytes)) return undefined;
        const text = await this.audio!.interpret({ merchantId, conversationId: context!.conversationId, inboxId: context!.inboxId,
          mediaId: media.id, mimeType: "audio/ogg", bytes });
        return { kind: "audio_transcript", text, scope: { merchantId, deviceId, inboxId: context!.inboxId,
          conversationId: context!.conversationId, mediaId: media.id } };
      }
      const attachmentContext = await this.interpreter.interpret(image ? { kind: "image", name: media.name ?? "Foto enviada pelo WhatsApp", mimeType, dataBase64: bytes.toString("base64") }
        : { kind: "shopping_list", name: media.name ?? "Lista de compras", mimeType, text: bytes.toString("utf8") },
      context ? { merchantId, conversationId: context.conversationId } : undefined);
      return attachmentContext ? { kind: "attachment_context", context: attachmentContext } : undefined;
    } catch { return undefined; }
  }
}
