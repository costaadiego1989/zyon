import { Global, Module } from "@nestjs/common";
import { S3UploadService } from "./s3-upload.service.js";

@Global()
@Module({
  providers: [S3UploadService],
  exports: [S3UploadService],
})
export class StorageModule {}
