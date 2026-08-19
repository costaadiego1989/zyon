/**
 * REPOSITORY FACTORY — feature flag driven
 *
 * This is the MIGRATION CONTROL CENTER.
 * Each line can be toggled independently to v1 without changing any component code.
 *
 * Example migration phases:
 * - Phase 1: useV1.catalog = true  (products load from /v1)
 * - Phase 2: useV1.settings = true (config loads from /v1)
 * - Phase 3: useV1.checkouts = true (conversations load from /v1)
 *
 * Rollback is 1 env var change.
 */

import { API_CONFIG } from "./api";
import {
  V1CatalogRepository,
  V1SettingsRepository,
  V1CartRepository,
  V1ConversationRepository,
} from "./v1-adapters";
import {
  InternalCatalogRepository,
  InternalSettingsRepository,
  InternalCartRepository,
  InternalConversationRepository,
} from "./internal-adapters";
import type { RepositoryFactory } from "./api";

/**
 * Creates the active repository factory based on feature flags.
 * Safe to call multiple times — returns a new instance each time.
 *
 * Usage:
 *   const repos = createRepositoryFactory(merchantId, embedToken);
 *   const products = await repos.catalog().listProducts();
 */
export function createRepositoryFactory(
  merchantId: string,
  embedToken: string,
): RepositoryFactory {
  return {
    catalog: () =>
      API_CONFIG.useV1.catalog
        ? new V1CatalogRepository()
        : new InternalCatalogRepository(merchantId),

    settings: () =>
      API_CONFIG.useV1.settings
        ? new V1SettingsRepository()
        : new InternalSettingsRepository(merchantId),

    cart: () =>
      API_CONFIG.useV1.checkouts
        ? new V1CartRepository()
        : new InternalCartRepository(merchantId),

    conversation: () =>
      API_CONFIG.useV1.checkouts
        ? new V1ConversationRepository()
        : new InternalConversationRepository(embedToken),

    buyer: () => {
      // Buyer stays internal ALWAYS (not in public API v1)
      throw new Error("Buyer repository not implemented for v1 — keeping internal");
    },
  };
}

/**
 * React Context for dependency injection.
 * Provides repositories to the entire storefront without prop-drilling.
 */
import { createContext, useContext } from "react";

export const RepositoryFactoryContext = createContext<RepositoryFactory | null>(null);

export function useRepositoryFactory(): RepositoryFactory {
  const factory = useContext(RepositoryFactoryContext);
  if (!factory) {
    throw new Error("useRepositoryFactory must be inside <RepositoryFactoryProvider>");
  }
  return factory;
}
