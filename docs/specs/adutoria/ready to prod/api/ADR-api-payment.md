# ADR — API / payment

> Atualização de implementação: consulte a [terceira etapa](../CORRECOES-ETAPA-3.md). O restante deste ADR preserva o diagnóstico original; validação local não encerra o gate de produção.

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Intenções, provedores, webhooks, billing e conciliação financeira.

Inventário: 62 arquivos de implementação, 30 arquivos reconhecidos como testes, 9292 linhas de implementação. 31 declarações HTTP; 31 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **buyer-account, checkout, commerce, integrations, merchant**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `checkoutSession`, `completedOrder`, `coupon`, `crossSellPromotion`, `merchantBillingSubscription`, `merchantCommerceConnection`, `merchantPaymentConnection`, `merchantUser`, `merchantWebhookEndpoint`, `outboxMessage`, `paymentCryptoTransfer`, `paymentIntent`, `paymentProviderEvent`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Mistura billing/plans e pagamento de pedido em boundary extenso. Falhas em criação pendente, taxas, retries Asaas e CAS; contrato para widget diverge. Testes de billing falharam e precisam triagem comercial.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 4/10 | 3/10 | 4/10 | 4/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Entidade define transições, há chave local idempotente e Stripe recebe chave estável; eventos/intenções têm caminho transacional e job de conciliação.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| HandleStripeWebhookUseCase | 287 | 5 | [apps/api/src/modules/payment/application/handle-stripe-webhook.use-case.ts:28](<../../../../../apps/api/src/modules/payment/application/handle-stripe-webhook.use-case.ts#L28>) |
| CreatePaymentIntentUseCase | 263 | 10 | [apps/api/src/modules/payment/application/create-payment-intent.use-case.ts:123](<../../../../../apps/api/src/modules/payment/application/create-payment-intent.use-case.ts#L123>) |
| PrismaPaymentPlatformRepository | 246 | 1 | [apps/api/src/modules/payment/infrastructure/prisma-payment-platform.repository.ts:16](<../../../../../apps/api/src/modules/payment/infrastructure/prisma-payment-platform.repository.ts#L16>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-012](<ADR-api-payment.md#api-012>) (P1): Retry do POST Asaas não usa a chave idempotente derivada.
- [API-013](<ADR-api-payment.md#api-013>) (P1): Intenção pendente sem ID do provedor não é retomada.
- [API-014](<ADR-api-payment.md#api-014>) (P1): Taxa do cartão diverge do total esperado na conclusão.
- [API-015](<ADR-api-payment.md#api-015>) (P1): Persistência não protege transições concorrentes do payment intent.
- [API-007](<ADR-api-returns.md#api-007>) (P0): Reembolso é declarado concluído sem devolver dinheiro.
- [W2-002](<../widget_v2/ADR-widget_v2.md#w2-002>) (P1): Resposta de intenção é lida com nomes que a API não retorna.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Provar captura/estorno/conciliação por provedor com falha parcial, amount breakdown imutável e concorrência de webhook.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /webhooks/asaas | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/asaas-webhook.controller.ts:11](<../../../../../apps/api/src/modules/payment/presentation/http/asaas-webhook.controller.ts#L11>) |
| POST /payment/intents/:intentId/crypto/confirm | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/crypto-payment.controller.ts:12](<../../../../../apps/api/src/modules/payment/presentation/http/crypto-payment.controller.ts#L12>) |
| GET /payment/mercadopago/callback | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts:50](<../../../../../apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts#L50>) |
| POST /merchants/me/payment-connections/mercadopago/oauth-link | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts:125](<../../../../../apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts#L125>) |
| POST /merchants/me/payment-connections/mercadopago/sync | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts:145](<../../../../../apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts#L145>) |
| POST /merchants/me/payment-connections/mercadopago/refresh-token | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts:160](<../../../../../apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts#L160>) |
| DELETE /merchants/me/payment-connections/mercadopago | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts:176](<../../../../../apps/api/src/modules/payment/presentation/http/mercadopago-oauth.controller.ts#L176>) |
| POST /webhooks/mercadopago | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/mercadopago-webhook.controller.ts:12](<../../../../../apps/api/src/modules/payment/presentation/http/mercadopago-webhook.controller.ts#L12>) |
| GET /payments/connections | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:90](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L90>) |
| POST /payments/connections/stripe/onboarding-link | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:125](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L125>) |
| POST /payments/connections/stripe/sync | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:160](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L160>) |
| POST /payments/connections/asaas | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:181](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L181>) |
| POST /payments/connections/asaas/onboarding-link | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:225](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L225>) |
| POST /payments/connections/asaas/sync | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:251](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L251>) |
| GET /merchants/me/payment-connections | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:289](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L289>) |
| POST /merchants/me/payment-connections/asaas | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:307](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L307>) |
| POST /merchants/me/payment-connections/stripe/connect | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:332](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L332>) |
| DELETE /merchants/me/payment-connections/:provider | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:352](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L352>) |
| GET /billing/subscription | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:393](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L393>) |
| POST /billing/checkout-session | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:428](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L428>) |
| POST /billing/portal-session | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:466](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L466>) |
| POST /billing/subscription/cancel | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:492](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L492>) |
| POST /billing/subscription/change-plan | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:512](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L512>) |
| POST /billing/subscription/pause | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:528](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L528>) |
| POST /billing/subscription/resume | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:542](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L542>) |
| GET /billing/payment-methods | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:555](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L555>) |
| POST /billing/subscription/payment-method | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts:567](<../../../../../apps/api/src/modules/payment/presentation/http/payment-platform.controller.ts#L567>) |
| POST /payment/intents | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/payment.controller.ts:14](<../../../../../apps/api/src/modules/payment/presentation/http/payment.controller.ts#L14>) |
| GET /payment/intents/:intentId/status | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/payment.controller.ts:19](<../../../../../apps/api/src/modules/payment/presentation/http/payment.controller.ts#L19>) |
| POST /payment/intents/:intentId/stripe/confirm | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/stripe-payment.controller.ts:12](<../../../../../apps/api/src/modules/payment/presentation/http/stripe-payment.controller.ts#L12>) |
| POST /webhooks/stripe | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/payment/presentation/http/stripe-webhook.controller.ts:12](<../../../../../apps/api/src/modules/payment/presentation/http/stripe-webhook.controller.ts#L12>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-012"></a>

## API-012 — Retry do POST Asaas não usa a chave idempotente derivada

| Campo | Registro |
| --- | --- |
| ID | API-012 |
| SEVERITY | P1 |
| MODULE | payment |
| FILE(S) | [apps/api/src/modules/payment/application/create-payment-intent.use-case.ts:86](<../../../../../apps/api/src/modules/payment/application/create-payment-intent.use-case.ts#L86>)<br>[apps/api/src/modules/payment/infrastructure/asaas-payment.adapter.ts:160](<../../../../../apps/api/src/modules/payment/infrastructure/asaas-payment.adapter.ts#L160>)<br>[apps/api/src/shared/http/http-client.service.ts:1](<../../../../../apps/api/src/shared/http/http-client.service.ts#L1>) |
| ISSUE | Retry do POST Asaas não usa a chave idempotente derivada |
| EVIDENCE | O use case deriva providerIdempotencyKey estável. Stripe encaminha a chave; o POST /v3/payments do Asaas não a utiliza. O HttpClientService compartilhado reexecuta falhas de rede/5xx para POST. |
| VERIFICATION | CONFIRMED_STATIC; comportamento externo UNVERIFIED |
| PRODUCTION IMPACT | Em timeout após aceitação do provedor, a tentativa pode criar outra cobrança; externalReference com ID local não comprova deduplicação no provedor. |
| ROOT CAUSE | Retry genérico de efeito financeiro sem protocolo de recuperação de resultado ambíguo. |
| RECOMMENDED FIX | Usar mecanismo de idempotência oficialmente suportado pelo provedor e/ou consultar intenção existente antes de reenviar; não repetir cegamente POST financeiro. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Simular provedor que cria a cobrança e derruba a resposta: retries e réplicas devem manter uma cobrança externa e uma intenção local. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-013"></a>

## API-013 — Intenção pendente sem ID do provedor não é retomada

| Campo | Registro |
| --- | --- |
| ID | API-013 |
| SEVERITY | P1 |
| MODULE | payment |
| FILE(S) | [apps/api/src/modules/payment/application/create-payment-intent.use-case.ts:149](<../../../../../apps/api/src/modules/payment/application/create-payment-intent.use-case.ts#L149>)<br>[apps/api/src/modules/payment/application/reconcile-payment-intents.use-case.ts:60](<../../../../../apps/api/src/modules/payment/application/reconcile-payment-intents.use-case.ts#L60>) |
| ISSUE | Intenção pendente sem ID do provedor não é retomada |
| EVIDENCE | A intenção é persistida antes da chamada externa; retry retorna qualquer existing.snapshot(). A reconciliação ignora intents sem providerPaymentId. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Erro/restart antes de salvar resultado do provedor pode deixar pagamento permanentemente pending, sem QR/clientSecret e sem nova tentativa útil. |
| ROOT CAUSE | Idempotência retorna estado incompleto sem máquina de estados de execução/reconciliação da intenção. |
| RECOMMENDED FIX | Registrar estágio de criação, lease e resultado ambíguo; retomar/consultar provedor pela chave estável, com timeout e transição recuperável. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Injetar crash após persistência inicial e após criação externa antes do save; retry precisa recuperar um resultado único utilizável. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-014"></a>

## API-014 — Taxa do cartão diverge do total esperado na conclusão

| Campo | Registro |
| --- | --- |
| ID | API-014 |
| SEVERITY | P1 |
| MODULE | payment |
| FILE(S) | [apps/api/src/modules/payment/application/create-payment-intent.use-case.ts:164](<../../../../../apps/api/src/modules/payment/application/create-payment-intent.use-case.ts#L164>)<br>[apps/api/src/modules/payment/infrastructure/stripe-env.ts:1](<../../../../../apps/api/src/modules/payment/infrastructure/stripe-env.ts#L1>)<br>[apps/api/src/modules/payment/application/services/payment-dispatch.service.ts:60](<../../../../../apps/api/src/modules/payment/application/services/payment-dispatch.service.ts#L60>)<br>[apps/api/src/modules/checkout/application/use-cases/complete-order.use-case.ts:60](<../../../../../apps/api/src/modules/checkout/application/use-cases/complete-order.use-case.ts#L60>) |
| ISSUE | Taxa do cartão diverge do total esperado na conclusão |
| EVIDENCE | CreatePaymentIntent soma a platform fee ao amountCents do cartão; o dispatcher passa esse montante integral à conclusão. CompleteOrder recalcula itens + frete - desconto sem essa taxa e rejeita diferença superior a R$0,02. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Cobrança aprovada pode falhar na conclusão do pedido com order_total_mismatch. A taxa padrão de R$1,99 excede a tolerância. |
| ROOT CAUSE | Dois cálculos de total com componentes monetários diferentes e sem objeto de preço comum. |
| RECOMMENDED FIX | Definir contrato de breakdown único (subtotal/desconto/frete/taxas/total) e usar a mesma versão imutável na intenção, provedor e pedido. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Cartão com taxa padrão, taxa zero e descontos deve concluir com o valor capturado correto; replay não cria pedido duplicado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-015"></a>

## API-015 — Persistência não protege transições concorrentes do payment intent

| Campo | Registro |
| --- | --- |
| ID | API-015 |
| SEVERITY | P1 |
| MODULE | payment |
| FILE(S) | [apps/api/src/modules/payment/infrastructure/prisma-payment.repository.ts:1](<../../../../../apps/api/src/modules/payment/infrastructure/prisma-payment.repository.ts#L1>)<br>[apps/api/src/modules/payment/domain/payment-intent.entity.ts:147](<../../../../../apps/api/src/modules/payment/domain/payment-intent.entity.ts#L147>) |
| ISSUE | Persistência não protege transições concorrentes do payment intent |
| EVIDENCE | A entidade valida transições no snapshot em memória, enquanto o repositório atualiza o status por upsert sem expectedVersion/status anterior no predicado. |
| VERIFICATION | CONFIRMED_STATIC; race em banco UNVERIFIED |
| PRODUCTION IMPACT | Dois eventos distintos podem ler o mesmo estado e sobrescrever aprovação/cancelamento/reembolso. Unicidade de eventId não serializa eventos diferentes da mesma intenção. |
| ROOT CAUSE | Estado do agregado não tem CAS/lock na persistência. |
| RECOMMENDED FIX | Versionar o agregado ou bloquear sua linha; persistir transição e outbox no mesmo commit, com regra explícita para eventos atrasados. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Competir approved/failed/cancelled/refunded, inclusive em ordem inversa; estados finais e efeitos financeiros devem obedecer ao histórico validado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
