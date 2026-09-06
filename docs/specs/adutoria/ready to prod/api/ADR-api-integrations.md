# ADR — API / integrations

> Atualização de implementação: consulte a [terceira etapa](../CORRECOES-ETAPA-3.md). O restante deste ADR preserva o diagnóstico original; validação local não encerra o gate de produção.

**Atualização da segunda etapa:** ver [correções, contratos e evidências](../CORRECOES-ETAPA-2.md). O texto da auditoria abaixo preserva o retrato anterior; gates de produção continuam abertos.

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Credenciais API, webhooks tenant, entregas e tracking de integrações.

Inventário: 28 arquivos de implementação, 9 arquivos reconhecidos como testes, 3496 linhas de implementação. 22 declarações HTTP; 22 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, checkout, payment**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

O extrator não reconheceu acessos Prisma diretos; isso não comprova ausência de persistência indireta/SQL.

Adapter do dispatcher quebra a interface fetch; estado sending precisa claim/lease exclusivo. Replays e rotação devem preservar auditoria e segredo usado por versão.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 5/10 | 6/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há assinatura de webhook, política DNS contra destinos privados, rotação e controles de acesso/scope.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| IntegrationsController | 306 | 10 | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:25](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L25>) |
| WebhookEndpointsController | 302 | 10 | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:48](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L48>) |
| PrismaIntegrationsRepository | 206 | 1 | [apps/api/src/modules/integrations/infrastructure/prisma-integrations.repository.ts:16](<../../../../../apps/api/src/modules/integrations/infrastructure/prisma-integrations.repository.ts#L16>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-018](<ADR-api-integrations.md#api-018>) (P1): Envio de webhook passa Agent incompatível ao fetch.
- [API-016](<ADR-api-shared.md#api-016>) (P1): Claim do outbox não conserva exclusividade até o processamento.
- [DASH-005](<../dashboard/ADR-dashboard.md#dash-005>) (P2): Salvar configurações busca ETag novo e pode sobrescrever edição concorrente.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Entrega real, DNS/TLS/redirect, timeout, 429, retry/dead-letter e autorização de replay por tenant.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /integrations/api-keys | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard) | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:44](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L44>) |
| POST /integrations/api-keys | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard); Idempotent({ redactResponseFields: ["secret_key"] }) | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:60](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L60>) |
| DELETE /integrations/api-keys/:apiKeyId | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard); Idempotent() | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:106](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L106>) |
| POST /integrations/api-keys/:apiKeyId/rotate | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard); Idempotent({ redactResponseFields: ["secret_key"] }) | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:125](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L125>) |
| GET /integrations/webhooks | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard) | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:165](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L165>) |
| POST /integrations/webhooks | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard); Idempotent({ redactResponseFields: ["signingSecret"] }) | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:181](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L181>) |
| PUT /integrations/webhooks/:endpointId | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard); Idempotent() | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:216](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L216>) |
| POST /integrations/webhooks/:endpointId/test | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard); Idempotent() | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:258](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L258>) |
| GET /integrations/webhook-deliveries | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard) | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:278](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L278>) |
| POST /integrations/webhook-deliveries/:deliveryId/replay | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard); Idempotent() | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:295](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L295>) |
| GET /integrations/shipments | Alcançável estaticamente | RequireTenantRoles("owner","admin"); UseGuards(AuthGuard,TenantRoleGuard) | [apps/api/src/modules/integrations/presentation/http/integrations.controller.ts:314](<../../../../../apps/api/src/modules/integrations/presentation/http/integrations.controller.ts#L314>) |
| PUT /integrations/orders/:externalOrderId/tracking | Alcançável estaticamente | UseGuards(MerchantApiKeyGuard,ApiKeyScopeGuard); Idempotent(); RequireApiKeyScopes("tracking:write") | [apps/api/src/modules/integrations/presentation/http/tenant-tracking.controller.ts:19](<../../../../../apps/api/src/modules/integrations/presentation/http/tenant-tracking.controller.ts#L19>) |
| GET /integrations/tracking/:trackingCode | Alcançável estaticamente | UseGuards(MerchantApiKeyGuard,ApiKeyScopeGuard); RequireApiKeyScopes("tracking:read") | [apps/api/src/modules/integrations/presentation/http/tenant-tracking.controller.ts:30](<../../../../../apps/api/src/modules/integrations/presentation/http/tenant-tracking.controller.ts#L30>) |
| GET /webhook-endpoints | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:67](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L67>) |
| POST /webhook-endpoints | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent({ redactResponseFields: ["signing_secret"] }); UseGuards(PlanLimitGuard) | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:96](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L96>) |
| GET /webhook-endpoints/:endpointId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:134](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L134>) |
| PUT /webhook-endpoints/:endpointId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:162](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L162>) |
| DELETE /webhook-endpoints/:endpointId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:211](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L211>) |
| POST /webhook-endpoints/:endpointId/rotate-secret | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent({ redactResponseFields: ["signing_secret"] }) | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:226](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L226>) |
| POST /webhook-endpoints/:endpointId/test | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:251](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L251>) |
| GET /webhook-endpoints/:endpointId/deliveries | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:277](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L277>) |
| POST /webhook-endpoints/:endpointId/deliveries/:deliveryId/replay | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts:318](<../../../../../apps/api/src/modules/integrations/presentation/http/webhook-endpoints.controller.ts#L318>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-018"></a>

## API-018 — Envio de webhook passa Agent incompatível ao fetch

| Campo | Registro |
| --- | --- |
| ID | API-018 |
| SEVERITY | P1 |
| MODULE | integrations |
| FILE(S) | [apps/api/src/modules/integrations/application/webhook-delivery-dispatcher.service.ts:124](<../../../../../apps/api/src/modules/integrations/application/webhook-delivery-dispatcher.service.ts#L124>)<br>[apps/api/src/modules/integrations/application/webhook-delivery-dispatcher.service.ts:231](<../../../../../apps/api/src/modules/integrations/application/webhook-delivery-dispatcher.service.ts#L231>)<br>[apps/api/src/modules/integrations/integrations.module.ts:49](<../../../../../apps/api/src/modules/integrations/integrations.module.ts#L49>) |
| ISSUE | Envio de webhook passa Agent incompatível ao fetch |
| EVIDENCE | Política DNS registrada produz endereços fixados; createPinnedAgent retorna node:http.Agent ou node:https.Agent e o atribui a fetchOptions.dispatcher. R02 reproduziu fetch failed com cause agent.dispatch is not a function no Node 22. |
| VERIFICATION | REPRODUCED_LOCAL R02; serviço completo estático |
| PRODUCTION IMPACT | Entregas que passam pela fixação de DNS falham antes da conexão, consomem retries e não chegam ao destinatário. |
| ROOT CAUSE | Confusão entre interfaces de Agent do HTTP nativo e Dispatcher do Undici. |
| RECOMMENDED FIX | Usar dispatcher compatível com fetch e resolver/conector que preserve validação/pinning de DNS e TLS; impedir redirect para destinos não validados; fechar recursos. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Servidor local recebe uma entrega com assinatura válida pelo adaptador real; cobrir IPv4/IPv6, redirecionamento bloqueado, timeout e retry. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
