import { Controller, Delete, Query, UseGuards, BadRequestException } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { S3UploadService } from "./s3-upload.service.js";
import { AuthGuard } from "../../modules/auth/presentation/auth.guard.js";

@ApiTags("Storage")
@UseGuards(AuthGuard)
@Controller("storage")
export class StorageController {
  constructor(private readonly s3: S3UploadService) {}

  @Delete("object")
  @ApiOperation({
    summary: "Delete S3 object by URL",
    description: "Permanently deletes an uploaded file from S3. Requires authentication.",
  })
  @ApiQuery({ name: "url", description: "Full S3 URL of the object to delete", required: true })
  @ApiResponse({ status: 200, description: "Object deleted" })
  @ApiResponse({ status: 400, description: "Invalid or missing URL" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async deleteObject(@Query("url") url: string) {
    if (!url?.trim()) throw new BadRequestException("url_required");
    await this.s3.delete(url.trim());
    return { deleted: true };
  }
}
