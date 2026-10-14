import { Injectable } from "@nestjs/common";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Fetch only configured public media origins, then let Meta serve the actual
 * JPEG/PNG instead of relying on its background crawler to hotlink a CDN. */
@Injectable()
export class MetaCloudImageUploadAdapter {
  private readonly cache = new Map<string, { id: string; expiresAt: number }>();

  async prepare(input: { link: string; phoneNumberId: string; accessToken: string; graph: string }): Promise<string | undefined> {
    const url = new URL(input.link);
    const hosts = new Set(["images.unsplash.com", ...(process.env.META_IMAGE_DOWNLOAD_ALLOWED_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean)]);
    const bucket = process.env.AWS_S3_BUCKET ?? "", region = process.env.AWS_S3_REGION ?? "us-east-1";
    if (/^[a-z0-9.-]{3,63}$/.test(bucket) && /^[a-z0-9-]+$/.test(region)) {
      hosts.add(`${bucket}.s3.${region}.amazonaws.com`); hosts.add(`${bucket}.s3.amazonaws.com`);
    }
    for (const setting of [process.env.S3_PUBLIC_URL, process.env.R2_PUBLIC_URL, process.env.MEDIA_PUBLIC_BASE_URL]) {
      if (setting) { try { hosts.add(new URL(setting).hostname); } catch { /* optional public storage setting */ } }
    }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("whatsapp_image_source_invalid");
    if (!hosts.has(url.hostname) && !/^[a-z0-9-]+\.r2\.dev$/.test(url.hostname)) return undefined;
    const key = `${input.phoneNumberId}:${url.href}`;
    const previous = this.cache.get(key);
    if (previous && previous.expiresAt > Date.now()) return previous.id;
    const download = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12000) });
    if (!download.ok || !download.body) throw new Error("whatsapp_image_download_failed");
    const declared = Number(download.headers.get("content-length"));
    if (declared > MAX_IMAGE_BYTES) { await download.body.cancel(); throw new Error("whatsapp_image_too_large"); }
    const reader = download.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("whatsapp_image_too_large"); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    const mime = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : undefined;
    if (!mime || !bytes.length) throw new Error("whatsapp_image_type_unsupported");
    const form = new FormData();
    form.set("messaging_product", "whatsapp"); form.set("type", mime);
    form.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), mime === "image/png" ? "product.png" : "product.jpg");
    const upload = await fetch(`${input.graph}/${input.phoneNumberId}/media`, { method: "POST", body: form,
      headers: { Authorization: `Bearer ${input.accessToken}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
    const result = await upload.json().catch(() => ({})) as { id?: unknown };
    if (!upload.ok || typeof result.id !== "string" || !/^\d+$/.test(result.id)) throw new Error("whatsapp_image_upload_failed");
    if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { id: result.id, expiresAt: Date.now() + 24 * 60 * 60_000 });
    return result.id;
  }
}
