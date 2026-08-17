import { Global, Module } from "@nestjs/common";
import { S3UploadService } from "./s3-upload.service.js";
import { StorageController } from "./storage.controller.js";

@Global()
@Module({
  controllers: [StorageController],
  providers: [S3UploadService],
  exports: [S3UploadService],
})
export class StorageModule {}
