import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HttpClientService } from "./http-client.service.js";
import { NonProductionRouteGuard } from "./non-production-route.guard.js";

@Global()
@Module({
  providers: [
    {
      provide: HttpClientService,
      useValue: new HttpClientService({ timeout: 15_000, retries: 3 }),
    },
    { provide: APP_GUARD, useClass: NonProductionRouteGuard },
  ],
  exports: [HttpClientService],
})
export class HttpModule {}
