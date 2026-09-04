# Support RAG — Tasks

## Phase 1: Core RAG (IN PROGRESS)

- [~] T1.1 Prisma: KnowledgeChunk + MerchantPolicy models
- [~] T1.2 Migration SQL (pgvector column + hnsw index + base64 fallback)
- [~] T1.3 Domain ports (knowledge-repository.port.ts)
- [~] T1.4 IndexProductUseCase (reuse EmbeddingService from catalog)
- [~] T1.5 IndexFaqUseCase
- [~] T1.6 QueryKnowledgeUseCase (embed → similarity search top-5)
- [~] T1.7 PrismaKnowledgeRepository (pgvector cosine + base64 fallback)
- [~] T1.8 Event handlers (on-product-upserted-kb, on-faq-updated)
- [~] T1.9 Integrate with SendSupportMessageUseCase (RAG context injection)
- [~] T1.10 Emit support.faq_updated event
- [~] T1.11 Export EmbeddingService from CatalogModule
- [~] T1.12 Register KnowledgeBaseModule in AppModule

**Reuses:**
- EmbeddingService (catalog/infrastructure/services/embedding.service.ts) — text-embedding-3-small, 1536 dims
- pgvector already set up (product_search_vectors precedent)
- product.upserted event (catalog add/update)
- DOMAIN_EVENT_BUS, PRISMA_CLIENT

## Phase 2: Policies + Dashboard (PENDING)

- [ ] T2.1 MerchantPolicy controller (GET/PUT /knowledge/policies)
- [ ] T2.2 IndexPolicyUseCase + on-policy-updated handler
- [ ] T2.3 Dashboard "Base de Conhecimento" page (Políticas tab)
- [ ] T2.4 Status tab (chunk counts, reindex button)

## Phase 3: Enhancement (PENDING)

- [ ] T3.1 Real-time stock in product chunks
- [ ] T3.2 Buyer order context (pedidos)
- [ ] T3.3 Intent detection (produto vs política vs pedido)
- [ ] T3.4 Config chunks (payment methods, delivery regions)

## Verification

- [ ] typecheck 0 errors
- [ ] migration applied
- [ ] product create → chunk indexed
- [ ] /support/chat/public with product question → RAG context used
- [ ] cross-tenant isolation
