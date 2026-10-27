import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { S3UploadService, UploadResult } from "../../../../shared/storage/s3-upload.service.js";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class UploadReturnImageUseCase {
  private readonly logger = new Logger(UploadReturnImageUseCase.name);

  constructor(private readonly s3: S3UploadService) {}

  async execute(input: { dataUri: string; merchantId: string }): Promise<UploadResult> {
    const match = input.dataUri.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) {
      throw new BadRequestException("invalid_data_uri_format");
    }

    const mimeType = match[1]!;
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(`invalid_image_type: ${mimeType} not in ${ALLOWED_MIME_TYPES.join(",")}`);
    }

    const buffer = Buffer.from(match[2]!, "base64");
    if (buffer.length > MAX_SIZE_BYTES) {
      throw new BadRequestException(`image_too_large: ${buffer.length} > ${MAX_SIZE_BYTES}`);
    }

    return this.s3.uploadBase64(input.dataUri, `returns/${input.merchantId}`);
  }
}
