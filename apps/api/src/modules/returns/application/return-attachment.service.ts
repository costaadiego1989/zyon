import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { S3UploadService } from "../../../shared/storage/s3-upload.service.js";
import { RealtimeCapabilityService } from "../../../shared/auth/realtime-capability.js";
import { requireSecret } from "../../../shared/config/secret-config.js";

export function validateReturnPhoto(dataUri: unknown) {
  if (typeof dataUri !== "string" || dataUri.length > 2_800_000) throw new BadRequestException("photo_too_large");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
  if (!match) throw new BadRequestException("invalid_photo_type");
  const buffer = Buffer.from(match[2]!, "base64");
  if (!buffer.length || buffer.length > 2_000_000) throw new BadRequestException("photo_too_large");
  const valid = match[1] === "image/jpeg" ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    : match[1] === "image/png" ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : buffer.subarray(0,4).toString() === "RIFF" && buffer.subarray(8,12).toString() === "WEBP";
  if (!valid || buffer.toString("base64") !== match[2]) throw new BadRequestException("invalid_photo_content");
  return { buffer, contentType: match[1]! };
}

@Injectable()
export class ReturnAttachmentService {
  private readonly logger = new Logger(ReturnAttachmentService.name);
  private readonly imageAccess = new Map<string, { url: string; expiresAt: number }>();
  private readonly key = createHmac("sha256", requireSecret("AACP_PII_ENC_KEY", "local-private-return-evidence-key")).update("support-photos-v1").digest();
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient, private readonly s3: S3UploadService,
    private readonly capabilities: RealtimeCapabilityService) {}
  async prepare(images: unknown, merchantId: string, uploadedBy: string) {
    if (images === undefined) return [];
    if (!Array.isArray(images) || images.length > 3) throw new BadRequestException("maximum_three_photos");
    // Total remains below the existing 5 MB JSON request limit after base64.
    if (images.reduce((sum, image) => sum + (typeof image === "string" ? image.length : 0), 0) > 4_500_000) throw new BadRequestException("photos_total_too_large");
    const validated = images.map(validateReturnPhoto);
    const useObjectStorage = this.s3.isConfigured();
    const prepared = [];
    try { for (const photo of validated) {
      const id = `att_${randomUUID()}`;
      const objectKey = `private-support/${merchantId}/${id}.enc`;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const encrypted = Buffer.concat([cipher.update(photo.buffer), cipher.final()]);
      const payload = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
      // The same bounded, encrypted evidence can be committed atomically in
      // PostgreSQL when private object storage is not configured.
      if (useObjectStorage) await this.s3.uploadPrivate(payload, objectKey);
      prepared.push({ id, merchantId, uploadedBy, storageKey: useObjectStorage ? objectKey : `database:${objectKey}`,
        contentType: photo.contentType, encryptedPayload: useObjectStorage ? null : new Uint8Array(payload) });
    } } catch (error) { await this.discardUnlinked(prepared); throw error; }
    return prepared;
  }
  async discardUnlinked(photos: Array<{ id: string; merchantId: string; storageKey: string }>) {
    for (const photo of photos) {
      if (photo.storageKey.startsWith("database:")) continue;
      try {
        if (!await this.prisma.supportAttachment.findFirst({ where: { id: photo.id, merchantId: photo.merchantId }, select: { id: true } })) await this.s3.deletePrivate(photo.storageKey);
      } catch { this.logger.warn("Unlinked support photo cleanup will need retry"); }
    }
  }
  urls(ids: string[], merchantId: string) {
    return ids.map(id => {
      const key = `${merchantId}:${id}`;
      const previous = this.imageAccess.get(key);
      if (previous && previous.expiresAt > Math.floor(Date.now() / 1000) + 60) return previous.url;
      const { token, expiresAt } = this.capabilities.issue({ purpose: "support-attachment", merchantId, resourceId: id });
      const url = `/support/attachments/${id}?access_token=${encodeURIComponent(token)}`;
      if (this.imageAccess.size >= 2000) this.imageAccess.delete(this.imageAccess.keys().next().value!);
      this.imageAccess.set(key, { url, expiresAt });
      return url;
    });
  }
  async read(id: string, token: string) {
    let merchantId: string;
    try { const claims = this.capabilities.verify(token, "support-attachment"); if (claims.resourceId !== id) throw new Error(); merchantId = claims.merchantId; }
    catch { throw new NotFoundException("attachment_not_found"); }
    const photo = await this.prisma.supportAttachment.findFirst({ where: { id, merchantId } });
    if (!photo) throw new NotFoundException("attachment_not_found");
    const bytes = photo.encryptedPayload ? Buffer.from(photo.encryptedPayload) : await this.s3.readPrivate(photo.storageKey);
    const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    return { contentType: photo.contentType, buffer: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]) };
  }
}
