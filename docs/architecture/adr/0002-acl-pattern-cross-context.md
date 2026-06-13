# ADR 0002 — Padrão ACL e Adapters por contexto

- **Status:** aceito
- **Data:** 2026-05-09
- **Decisores:** Engenharia
- **Relacionado:** [ADR 0001](./0001-modular-monolith-bounded-contexts.md), [ADR 0003](./0003-event-bus-and-transactional-outbox.md)

## Contexto

Hoje cada contexto fala com vendors externos (Asaas, Shopify, OpenAI/DeepSeek,
Brevo, ViaCEP) por adapters dentro de `infrastructure/`. O padrão funciona
para ACL externa, mas existem duas brechas:

1. **ACL inter-contexto sem padronização.** O `CheckoutPaymentAdapter`
   é um caso bem feito: traduz "pagamento aprovado" do vocabulário do
   payment para um efeito no checkout. Mas o `ApplyNegotiationAgreementToCheckoutUseCase`
   está em `negotiation/application/`, não em adapter, e injeta a porta
   do checkout direto. Isso cria assimetria.
2. **Adapters externos sem timeout/retry/circuit-breaker padronizados.**
   Cada adapter chama `globalThis.fetch` com cara própria.

## Decisão

### 2.1 ACL inter-contexto

Quando um contexto **A** precisa reagir a um fato do contexto **B**:

- **Caso preferido (assíncrono):** B publica evento → A tem
  `${EventName}Handler` em `infrastructure/event-handlers/` que traduz
  o evento de B para o vocabulário de A e invoca um use-case de A.
- **Caso síncrono (apenas leitura):** B exporta uma porta
  `IXxxReadModel` consumida por A via DI. Sem injeção de use-case.

Convenção de nomes:
```
{ctx-A}/infrastructure/event-handlers/on-{evento-de-B}.handler.ts
{ctx-A}/infrastructure/adapters/{ctx-B}-{capability}.adapter.ts  // p/ leitura
```

### 2.2 ACL externa (vendors)

Toda integração externa **obriga**:

```ts
// pseudo
class AsaasPaymentAdapter implements PaymentProviderPort {
  constructor(
    private readonly http: HttpClient // wrapper central
  ) {}

  async createCharge(input: CreateChargeInput): Promise<PaymentProviderCharge> {
    const response = await this.http.post('/charges', mapToVendor(input), {
      timeoutMs: 5000,
      retries: 3,
      retryOnStatusCodes: [429, 502, 503, 504],
      circuitBreakerKey: 'asaas',
    });
    return mapFromVendor(response);
  }
}
```

Requisitos do `HttpClient` (construído na Onda 5):

- Timeout default 5 s (override por chamada).
- Retry exponencial com jitter (3 tentativas para 429/5xx; nunca para 4xx).
- Circuit breaker por `circuitBreakerKey` (libs candidatas: `cockatiel`).
- Telemetria obrigatória: `outgoing_http_requests_total{vendor, status}`,
  `outgoing_http_duration_seconds{vendor}`.
- Headers obrigatórios: `x-correlation-id` (do AsyncLocalStorage), `user-agent: aacp-api/{ver}`.

### 2.3 Mapping puro em `domain/services/{vendor}-mapping.ts`

Para cada vendor, criamos um módulo puro de mapping
(`domain/services/asaas-mapping.ts`, `shopify-mapping.ts`) testado em isolado.
O adapter **só** chama o HttpClient + chama o mapping. Isso permite
contract tests sem rede.

## Alternativas consideradas

- **Deixar cada adapter com seu próprio fetch:** atual; não escala
  observabilidade nem tolerância a falha.
- **gRPC interno:** overkill; sem ganho enquanto for monólito.
- **Service mesh (Linkerd/Istio):** fora de escopo; só relevante se
  extrair serviços.

## Consequências

**Positivas:**
- Código de adapters fica fino e auditável.
- Mocks de teste viram trivial (basta stub do `HttpClient`).
- Métricas de qualidade externa surgem grátis.

**Negativas:**
- Refatorar 5 adapters existentes (Asaas, Shopify, OpenAI/DeepSeek,
  Brevo, ViaCEP). Trabalho mecânico mas obrigatório.

## Plano de adoção

- Onda 5 do roadmap: criar `HttpClientModule`, migrar adapters um-por-PR.
- Cada adapter ganha contract test em `infrastructure/adapters/{vendor}-{cap}.adapter.contract.spec.ts`
  validando o mapping + chamadas HTTP gravadas (nock).
