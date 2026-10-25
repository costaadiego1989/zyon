/**
 * Config Context Embedding — barrel exports.
 */

export { ConfigDocumentBuilder } from "./config-document-builder.js";
export type { MerchantConfigDocument } from "./config-document-builder.js";

export { EmbeddingService } from "./embedding-service.js";
export type { EmbeddingResult, EmbeddingServicePort, EmbeddingServiceOptions } from "./embedding-service.js";

export { ConfigRegenerationHandler } from "./config-regeneration-handler.js";
export type { ConfigEventType, ConfigRegenerationHandlerDeps, ConfigDocumentBuilderPort } from "./config-regeneration-handler.js";

export { injectConfigDocument } from "./context-injection.js";

export {
  InMemoryConfigEmbeddingRepository,
  CONFIG_EMBEDDING_REPOSITORY
} from "./config-embedding-repository.js";
export type {
  ConfigEmbeddingRepository,
  MerchantConfigEmbeddingRecord,
  ConfigSources
} from "./config-embedding-repository.js";
