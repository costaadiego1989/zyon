import { Global, Module } from "@nestjs/common";
import { HttpClientService } from "./http-client.service.js";

@Global()
@Module({
  providers: [{ provide: HttpClientService, useValue: new HttpClientService({ timeout: 15_000, retries: 3 }) }],
  exports: [HttpClientService],
})
export class HttpModule {}
