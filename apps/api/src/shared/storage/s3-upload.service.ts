import { Injectable, Logger } from "@nestjs/common";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

export interface UploadResult {
  url: string;
  key: string;
  bucket: string;
}

@Injectable()
export class S3UploadService {
  private readonly logger = new Logger(S3UploadService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint: string | undefined;

  constructor() {
    this.bucket = process.env.AWS_S3_BUCKET ?? "";
    this.region = process.env.AWS_S3_REGION ?? "us-east-1";
    this.endpoint = process.env.AWS_S3_ENDPOINT || undefined;

    if (!this.bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      this.logger.warn("S3 not configured — uploads will fail. Set AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.");
      this.client = null;
      return;
    }

    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: !!this.endpoint, // LocalStack/R2 compatibility
    });
  }

  async upload(buffer: Buffer, contentType: string, folder: string, filename?: string): Promise<UploadResult> {
    if (!this.client) {
      throw new Error("s3_not_configured");
    }

    const ext = contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const key = `${folder}/${filename ?? randomUUID()}.${ext}`;

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }));

    const url = this.endpoint
      ? `${this.endpoint}/${this.bucket}/${key}`
      : `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

    this.logger.log(`Uploaded ${key} (${buffer.length} bytes) → ${url}`);
    return { url, key, bucket: this.bucket };
  }

  async uploadBase64(dataUri: string, folder: string): Promise<UploadResult> {
    const match = dataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) throw new Error("invalid_base64_data_uri");
    const contentType = match[1]!;
    const buffer = Buffer.from(match[2]!, "base64");
    return this.upload(buffer, contentType, folder);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }
}
