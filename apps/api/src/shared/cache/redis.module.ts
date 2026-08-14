/**
 * Redis client factory module.
 * Provides Redis instance for cache services.
 * Gracefully handles missing Redis (returns null).
 */

import { Global, Module } from "@nestjs/common";
import { Logger } from "@nestjs/common";

export const REDIS_CLIENT_TOKEN = "REDIS_CLIENT";

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT_TOKEN,
      useFactory: (): any => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          const logger = new Logger("RedisModule");
          logger.warn("REDIS_URL not set — caching services will be skipped");
          return null;
        }

        try {
          // Dynamic import to handle ESM + CommonJS compatibility
          const Redis = require("ioredis");
          const client = new Redis(redisUrl, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            enableOfflineQueue: false,
            lazyConnect: true,
          });

          client.on("error", (err: Error) => {
            const logger = new Logger("RedisModule");
            logger.error(`Redis connection error: ${err.message}`);
          });

          void client.connect();
          return client;
        } catch (error) {
          const logger = new Logger("RedisModule");
          logger.error(`Failed to create Redis client: ${(error as Error).message}`);
          return null;
        }
      },
    },
  ],
  exports: [REDIS_CLIENT_TOKEN],
})
export class RedisModule {}
