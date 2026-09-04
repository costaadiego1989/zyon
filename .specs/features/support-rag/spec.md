# Support RAG — Spec

## Visão

Agente de suporte do storefront responde perguntas do buyer usando RAG com pgvector. Knowledge base por merchant: catálogo de produtos, políticas da loja, FAQ, configurações. Buyer pergunta qualquer coisa → similarity search acha chunks relevantes → LLM responde com base nesses chunks, sem inventar.

## Requisitos

### RAG-01: Knowledge Base por Merchant
- Cada merchant tem knowledge base isolada (tenant boundary)
- Fontes de dados indexadas:
  - Produtos (nome, descrição, variantes, preço, estoque)
  - Políticas da loja (troca, envio, garantia, pagamento) — texto livre
  - FAQ configurado no hub de suporte
  - Configurações (meios de pagamento, regiões de entrega)
- Chunks armazenados com embedding vetorial (pgvector, 1536 dims — OpenAI ada-002)

### RAG-02: Indexação Automática
- **Produto criado/editado** → reindex chunks do produto (nome + descrição + variantes + preço)
- **FAQ atualizado** → reindex chunks de FAQ
- **Política salva** → reindex chunk de política
- Indexação async (event-driven, não bloqueia o save)
- Chunk size: ~500 tokens max por chunk (overlap 50 tokens entre chunks adjacentes)

### RAG-03: Query Pipeline
- Buyer envia mensagem → embed query → similarity search (cosine, top-5 chunks)
- Chunks relevantes injetados no system prompt como CONTEXTO
- LLM responde APENAS com base no contexto (regra "NÃO INVENTE" mantida)
- Se nenhum chunk relevante (score < threshold 0.7) → fallback: "Não tenho essa informação, posso encaminhar para um atendente."

### RAG-04: Políticas da Loja (nova UI)
- Dashboard → Configurações → seção "Base de Conhecimento" ou "Políticas"
- Campos de texto livre (até 5000 chars cada):
  - Política de trocas e devoluções
  - Política de envio e frete
  - Política de garantia
  - Formas de pagamento e parcelamento
  - Informações gerais (horário, contato, sobre a loja)
- Ao salvar → trigger reindex dos chunks de política

### RAG-05: Busca de Produtos no Contexto
- Quando buyer menciona produto ("tênis preto", "camiseta GG"), similarity search acha produto(s) relevante(s)
- Resposta inclui: nome, preço, disponibilidade, variantes, link
- Se produto fora de estoque → informa e sugere alternativas (se existirem chunks similares)

### RAG-06: Contexto de Pedido (buyer-specific)
- Se buyer autenticado (tem session com globalUserId), pode perguntar sobre seus pedidos
- Pipeline: detect intent "pedido" → query CompletedOrder por buyer → inject status/rastreio
- Se não autenticado → "Para consultar pedidos, informe seu email ou número do pedido."

## Arquitetura

### Prisma Models

```prisma
model KnowledgeChunk {
  id          String   @id @default(cuid())
  merchantId  String   @map("merchant_id")
  sourceType  String   @map("source_type")  // product | policy | faq | config
  sourceId    String?  @map("source_id")    // productId, faqItemId, etc.
  content     String                         // texto do chunk
  embedding   Unsupported("vector(1536)")    // pgvector
  metadata    Json?                          // { productName, price, sku, ... }
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@index([merchantId, sourceType])
  @@map("knowledge_chunks")
}

model MerchantPolicy {
  id            String   @id @default(cuid())
  merchantId    String   @unique @map("merchant_id")
  returns       String?  @db.Text  // Política de trocas
  shipping      String?  @db.Text  // Política de envio
  warranty      String?  @db.Text  // Garantia
  payment       String?  @db.Text  // Pagamento e parcelamento
  general       String?  @db.Text  // Informações gerais
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@map("merchant_policies")
}
```

### Module Structure

```
modules/knowledge-base/
  domain/
    ports/
      embedding.port.ts          # EmbeddingPort { embed(text): number[] }
      knowledge-repository.port.ts  # CRUD chunks + similarity search
    entities/
      knowledge-chunk.entity.ts
  application/
    use-cases/
      index-product.use-case.ts       # Product → chunks → embed → store
      index-policy.use-case.ts        # Policy text → chunks → embed → store
      index-faq.use-case.ts           # FAQ items → chunks → embed → store
      query-knowledge.use-case.ts     # Query → embed → similarity → top-N chunks
      reindex-merchant.use-case.ts    # Full reindex (manual trigger)
    services/
      chunker.service.ts              # Split text into ~500 token chunks
      context-builder.service.ts      # Assemble LLM context from chunks
  infrastructure/
    adapters/
      openai-embedding.adapter.ts     # OpenAI text-embedding-ada-002
    repositories/
      prisma-knowledge.repository.ts  # pgvector similarity search
    event-handlers/
      on-product-upserted.handler.ts  # product.upserted → reindex
      on-faq-updated.handler.ts       # support.faq_updated → reindex
      on-policy-updated.handler.ts    # policy.updated → reindex
  presentation/http/
    knowledge-admin.controller.ts     # GET status, POST reindex
    merchant-policy.controller.ts     # GET/PUT policies
  knowledge-base.module.ts
```

### Integração com Support Chat

```
POST /support/chat/public
  ↓
SendSupportMessageUseCase (enhanced)
  ↓
1. QueryKnowledgeUseCase.execute(merchantId, buyerMessage)
   → Embed query → pgvector similarity search → top-5 chunks
  ↓
2. ContextBuilder.build(chunks, buyerMessage)
   → System prompt + relevant context assembled
  ↓
3. LLM.complete([system + context, user message])
   → Response based ONLY on retrieved context
  ↓
4. isSafeGeneratedMessage guard
  ↓
5. Return reply (or handoff if no relevant context found)
```

### Embedding Strategy

| Fonte | Chunk format | Quando indexar |
|-------|-------------|----------------|
| Produto | `"Produto: {nome}. Preço: R${preço}. {descrição}. Variantes: {lista}. Estoque: {qty}."` | product.upserted event |
| Política | `"Política de {tipo}: {texto}"` (split if > 500 tokens) | Policy saved |
| FAQ | `"Pergunta: {q}. Resposta: {a}."` | FAQ updated |
| Config | `"Formas de pagamento: {lista}. Regiões de entrega: {lista}."` | Merchant rules updated |

### pgvector Setup

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Similarity search function
CREATE INDEX knowledge_chunks_embedding_idx 
  ON knowledge_chunks 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

Query:
```sql
SELECT id, content, metadata, 
       1 - (embedding <=> $1::vector) as similarity
FROM knowledge_chunks
WHERE merchant_id = $2
  AND 1 - (embedding <=> $1::vector) > 0.7
ORDER BY embedding <=> $1::vector
LIMIT 5;
```

### Dashboard UI

**Página: Base de Conhecimento (ou dentro de Configurações)**

Tab 1: Políticas
- 5 campos textarea (returns, shipping, warranty, payment, general)
- Botão "Salvar" → PUT /knowledge/policies → trigger reindex
- Indicador: "Última indexação: há 5 min" / "Indexando..."

Tab 2: Status
- Total de chunks indexados
- Breakdown: X produtos, Y políticas, Z FAQ items
- Botão "Reindexar tudo" (manual trigger)
- Última atualização por fonte

## Dependências

### Existentes (reutiliza)
- `DOMAIN_EVENT_BUS` — product.upserted, support.faq_updated events
- `OpenAI` — já configurado (OPENAI_API_KEY) pra conversation-engine
- `PostgreSQL` — já tem, só precisa extensão pgvector
- `Catálogo` module — query produtos
- `Support` module — FAQ items
- `Operations` module — pedidos do buyer

### Novas
- `pgvector` extension no PostgreSQL
- `OpenAI text-embedding-ada-002` (ou text-embedding-3-small)
- Model `KnowledgeChunk` + `MerchantPolicy`
- Module `knowledge-base`

## Custos

- Embedding: ~$0.0001 por 1000 tokens (ada-002) — negligível
- Storage: 1536 floats × N chunks × merchants — ~6KB por chunk
- Query: 1 embedding call + 1 pgvector search por mensagem do buyer
- LLM: mesmo custo atual (só muda conteúdo do prompt, não o tamanho)

## Fases

### Phase 1: Core RAG
- pgvector extension + migration
- KnowledgeChunk model
- Embedding adapter (OpenAI)
- Chunker service
- Index product use case + event handler
- Query knowledge use case
- Integrar com SendSupportMessageUseCase

### Phase 2: Policies + Dashboard
- MerchantPolicy model
- Policy controller (GET/PUT)
- Index policy use case + event handler
- Dashboard UI (Políticas tab)

### Phase 3: Product Context Enhancement
- Enrich product chunks com variantes + estoque real-time
- Buyer-specific context (pedidos)
- Intent detection (produto vs política vs pedido)

## Verificação

- Merchant salva política → chunk indexado → buyer pergunta sobre troca → resposta vem da política
- Produto cadastrado → chunk indexado → buyer pergunta "tem tênis preto?" → resposta com nome/preço/estoque
- Pergunta sem contexto relevante → "Não tenho essa informação" + handoff
- Cross-tenant: merchant A não vê chunks de merchant B
