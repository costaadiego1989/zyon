import { Logger, type FactoryProvider } from "@nestjs/common";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { STOREFRONT_USE_CASE_OBSERVATION, type StorefrontUseCaseObservation, type StorefrontObservationBoundary, type StorefrontUseCaseObservationReason } from "../../domain/ports/storefront-use-case-observation.port.js";
import { StorefrontObserver, observeStorefrontOperation, recordStorefrontDecision } from "./storefront-observation.js";

export class StorefrontUseCaseObserver extends StorefrontObserver implements StorefrontUseCaseObservation {
  operation<T>(stage: "validation" | "persistence" | "generation", boundary: StorefrontObservationBoundary, execute: () => Promise<T>): Promise<T> {
    return observeStorefrontOperation(stage, execute, { boundary });
  }
  decision(boundary: StorefrontObservationBoundary, outcome: "rejected" | "fallback", reason: StorefrontUseCaseObservationReason): void {
    recordStorefrontDecision(boundary === "generation" ? "generation" : "validation", outcome, reason, { boundary });
  }
}

export const storefrontUseCaseObservationProvider: FactoryProvider<StorefrontUseCaseObservation> = {
  provide: STOREFRONT_USE_CASE_OBSERVATION,
  inject: [{ token: MetricsService, optional: true }],
  useFactory: (metrics?: MetricsService) => {
    const logger = new Logger("StorefrontUseCaseObserver");
    return new StorefrontUseCaseObserver({ enabled: process.env.STOREFRONT_LLM_OBSERVABILITY === "enabled", metrics,
      record: event => logger.log({ event: "storefront.observation", ...event }) });
  },
};

