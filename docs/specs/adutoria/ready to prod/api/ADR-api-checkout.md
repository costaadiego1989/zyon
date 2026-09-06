# ADR — API / checkout

> Atualização de implementação: consulte a [terceira etapa](../CORRECOES-ETAPA-3.md). O restante deste ADR preserva o diagnóstico original; validação local não encerra o gate de produção.

> Implementação posterior na branch `fix/ready-to-prod-audit`: consultar [correções, evidências e pendências](../CORRECOES.md). O conteúdo abaixo preserva o retrato da auditoria original; o gate de produção continua aberto.


Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Orquestrar sessão, chat, ofertas, carrinho, conclusão e rastreio do pedido.

Inventário: 80 arquivos de implementação, 52 arquivos reconhecidos como testes, 8693 linhas de implementação. 17 declarações HTTP; 17 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **agent-rules, buyer-account, buyer-purchase-history, cart-recovery, catalog, checkout-settings, cross-sell, experiments, intent-memory, marketplace, merchant, negotiation, payment, revenue-lift, shipping**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `acceptedOffer`, `authorizedOffer`, `buyerIdentity`, `checkoutEvent`, `checkoutIntervention`, `checkoutSession`, `checkoutSetting`, `completedOrder`, `merchantNegotiationPolicy`, `merchantRule`, `outboxHandlerExecution`, `outboxMessage`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Orquestração tem alto fan-out e serviços extensos. Invariantes de preço/identidade na criação são frágeis; pós-commit contém I/O e gravações intermodulares sem recuperação durável.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 4/10 | 3/10 | 3/10 | 3/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

CompleteOrder tem caminho de transação para pedido+evento+outbox; UpdateCart recalcula soma e invalida shipping; há portas de sessão/oferta/pedido.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| PrismaCheckoutRepository | 491 | 1 | [apps/api/src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts:28](<../../../../../apps/api/src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts#L28>) |
| SendChatMessageUseCase | 464 | 15 | [apps/api/src/modules/checkout/application/use-cases/send-chat-message.use-case.ts:43](<../../../../../apps/api/src/modules/checkout/application/use-cases/send-chat-message.use-case.ts#L43>) |
| CheckoutShippingService | 293 | 5 | [apps/api/src/modules/checkout/application/services/checkout-shipping.service.ts:11](<../../../../../apps/api/src/modules/checkout/application/services/checkout-shipping.service.ts#L11>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-042](<ADR-api-checkout.md#api-042>) (P0): E-mail conhecido é tratado como prova de identidade do comprador.
- [API-043](<ADR-api-checkout.md#api-043>) (P0): Preço e frete iniciais podem vir do cliente sem revalidação de catálogo.
- [API-014](<ADR-api-payment.md#api-014>) (P1): Taxa do cartão diverge do total esperado na conclusão.
- [API-016](<ADR-api-shared.md#api-016>) (P1): Claim do outbox não conserva exclusividade até o processamento.
- [API-017](<ADR-api-inventory.md#api-017>) (P1): Handler de venda injeta token incorreto e absorve falhas.
- [W2-001](<../widget_v2/ADR-widget_v2.md#w2-001>) (P1): Início não hidrata carrinho e identidade usados pelo pagamento.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Uma compra deve manter preço autoritativo, identidade comprovada, estado versionado, pagamento único e outbox recuperável.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /checkout/start-checkout | Registrada, bloqueada em prod salvo flag legacy | UseGuards(PlanLimitGuard) | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:60](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L60>) |
| POST /checkout/track-event | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:67](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L67>) |
| GET /checkout/checkout/:merchantId/:sessionId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:72](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L72>) |
| POST /checkout/decision | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:77](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L77>) |
| POST /checkout/chat/message | Registrada, bloqueada em prod salvo flag legacy | UseGuards(PlanLimitGuard) | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:82](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L82>) |
| POST /checkout/shipping/evaluate | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:89](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L89>) |
| POST /checkout/offers/apply | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:94](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L94>) |
| POST /checkout/orders/complete | Registrada, bloqueada em prod salvo flag legacy | UseGuards(PlanLimitGuard) | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:99](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L99>) |
| PATCH /checkout/orders/tracking | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:106](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L106>) |
| PATCH /checkout/cart | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:112](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L112>) |
| GET /checkout/dashboard/overview/:merchantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:118](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L118>) |
| GET /checkout/dashboard/store-overview/:merchantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:123](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L123>) |
| GET /checkout/dashboard/overview/timeseries/:merchantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:132](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L132>) |
| GET /checkout/dashboard/rules/:merchantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:141](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L141>) |
| PUT /checkout/dashboard/rules/:merchantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:146](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L146>) |
| GET /checkout/funnel/:merchantId | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:151](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L151>) |
| GET /checkout/funnel/:merchantId/sessions | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/checkout/presentation/http/checkout.controller.ts:170](<../../../../../apps/api/src/modules/checkout/presentation/http/checkout.controller.ts#L170>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-042"></a>

## API-042 — E-mail conhecido é tratado como prova de identidade do comprador

| Campo | Registro |
| --- | --- |
| ID | API-042 |
| SEVERITY | P0 |
| MODULE | checkout |
| FILE(S) | [apps/api/src/modules/checkout/application/services/checkout-customer.service.ts:126](<../../../../../apps/api/src/modules/checkout/application/services/checkout-customer.service.ts#L126>)<br>[apps/api/src/modules/checkout/application/services/buyer-recognition.service.ts:118](<../../../../../apps/api/src/modules/checkout/application/services/buyer-recognition.service.ts#L118>)<br>[apps/api/src/modules/checkout/application/services/buyer-recognition.service.ts:61](<../../../../../apps/api/src/modules/checkout/application/services/buyer-recognition.service.ts#L61>) |
| ISSUE | E-mail conhecido é tratado como prova de identidade do comprador |
| EVIDENCE | hydrateReturningBuyerFromEmailHint consulta conta por email, considera existência da conta/prior session verificada suficiente e define email_verified=true na sessão atual sem OTP. O reconhecimento pode preencher nome/telefone/endereço e globalUserId. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Informar o email de um comprador existente pode vincular a identidade dele e expor dados de perfil numa sessão nova. Histórico de verificação não prova posse no request atual. |
| ROOT CAUSE | Reconhecimento comercial confundido com autenticação. |
| RECOMMENDED FIX | Exigir buyer JWT verificado ou desafio OTP atual antes de vincular globalUserId/hidratar PII. Manter dados reconhecidos opacos até comprovação. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Sessão nova com email de vítima, sem OTP/buyer token, permanece não verificada e não recebe dados da conta. Cobrir início e captura por chat. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-043"></a>

## API-043 — Preço e frete iniciais podem vir do cliente sem revalidação de catálogo

| Campo | Registro |
| --- | --- |
| ID | API-043 |
| SEVERITY | P0 |
| MODULE | checkout |
| FILE(S) | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:94](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L94>)<br>[apps/api/src/modules/checkout/application/use-cases/start-checkout.use-case.ts:124](<../../../../../apps/api/src/modules/checkout/application/use-cases/start-checkout.use-case.ts#L124>)<br>[apps/api/src/modules/checkout/domain/entities/checkout-session.entity.ts:19](<../../../../../apps/api/src/modules/checkout/domain/entities/checkout-session.entity.ts#L19>)<br>[apps/api/src/modules/payment/application/create-payment-intent.use-case.ts:164](<../../../../../apps/api/src/modules/payment/application/create-payment-intent.use-case.ts#L164>)<br>[apps/api/src/modules/payment/application/create-payment-intent.use-case.ts:361](<../../../../../apps/api/src/modules/payment/application/create-payment-intent.use-case.ts#L361>) |
| ISSUE | Preço e frete iniciais podem vir do cliente sem revalidação de catálogo |
| EVIDENCE | Embed/start encaminha cart/customer/shipping do body; StartCheckout persiste esses valores. CreatePaymentIntent calcula a cobrança a partir do snapshot e só valida commerce externo quando cart.commerceCartRef existe. Recalcular soma em CompleteOrder não valida o preço original. |
| VERIFICATION | CONFIRMED_STATIC; cobrança externa não executada |
| PRODUCTION IMPACT | Token embed com checkout:start pode inicializar itens, descontos ou frete adulterados e alimentar intenção com valor inferior ao catálogo quando não há commerceCartRef. Guard de tenant não garante autoridade de preço. |
| ROOT CAUSE | Dados recebidos do navegador se tornam fonte monetária do servidor sem carregamento autoritativo dos SKUs e quote. |
| RECOMMENDED FIX | Aceitar somente referência de carrinho ou SKU+quantidade; carregar preço/estoque/desconto/frete no servidor, rejeitar totais e flags de verificação enviados pelo cliente. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Alterar price,total,currentDiscount,shipping e campos customer.*_verified no body não altera o valor autorizado nem o estado de autenticação; SKU desconhecido deve falhar. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
