# ADR — API / commerce

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Conectar plataformas externas, validar carrinho e sincronizar pedido.

Inventário: 39 arquivos de implementação, 15 arquivos reconhecidos como testes, 3490 linhas de implementação. 10 declarações HTTP; 9 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **integrations, payment**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `commercePaidEvent`, `commercePendingOrder`, `merchantCommerceConnection`, `outboxMessage`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Commerce está no ciclo checkout/payment. A validação só participa se commerceCartRef estiver no snapshot; webhook VTEX não aparece montado. Consistência externa após resposta ambígua e invalidação de cache de conexão não foram exercitadas.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 5/10 | 6/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há factory de adaptador por tenant, credenciais persistidas cifradas e política de retry com jitter; validação do carrinho é encapsulada em caso de uso.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| CommerceConnectionsController | 190 | 5 | [apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts:39](<../../../../../apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts#L39>) |
| NuvemshopWebhookController | 156 | 3 | [apps/api/src/modules/commerce/presentation/http/nuvemshop-webhook.controller.ts:43](<../../../../../apps/api/src/modules/commerce/presentation/http/nuvemshop-webhook.controller.ts#L43>) |
| ShopifyWebhookController | 154 | 3 | [apps/api/src/modules/commerce/presentation/http/shopify-webhook.controller.ts:41](<../../../../../apps/api/src/modules/commerce/presentation/http/shopify-webhook.controller.ts#L41>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-012](<ADR-api-payment.md#api-012>) (P1): Retry do POST Asaas não usa a chave idempotente derivada.
- [API-013](<ADR-api-payment.md#api-013>) (P1): Intenção pendente sem ID do provedor não é retomada.
- [API-022](<ADR-api-operations.md#api-022>) (P1): Cancelamento local pode encerrar antes do cancelamento externo.
- [API-043](<ADR-api-checkout.md#api-043>) (P0): Preço e frete iniciais podem vir do cliente sem revalidação de catálogo.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Testar cada provedor habilitado: HMAC, replay, rotação de credenciais, divergência de preço e reconciliação de pedido após timeout.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /commerce/connections | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts:53](<../../../../../apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts#L53>) |
| POST /commerce/connections | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent(); UseGuards(PlanLimitGuard) | [apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts:85](<../../../../../apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts#L85>) |
| POST /commerce/connections/test | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts:157](<../../../../../apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts#L157>) |
| POST /commerce/connections/sync | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts:188](<../../../../../apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts#L188>) |
| DELETE /commerce/connections | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts:210](<../../../../../apps/api/src/modules/commerce/presentation/http/commerce-connections.controller.ts#L210>) |
| POST /webhooks/nuvemshop/:merchantId | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/commerce/presentation/http/nuvemshop-webhook.controller.ts:61](<../../../../../apps/api/src/modules/commerce/presentation/http/nuvemshop-webhook.controller.ts#L61>) |
| POST /webhooks/shopify/:merchantId | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/commerce/presentation/http/shopify-webhook.controller.ts:54](<../../../../../apps/api/src/modules/commerce/presentation/http/shopify-webhook.controller.ts#L54>) |
| POST /webhooks/tray/:merchantId | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/commerce/presentation/http/tray-webhook.controller.ts:57](<../../../../../apps/api/src/modules/commerce/presentation/http/tray-webhook.controller.ts#L57>) |
| POST /webhooks/vtex/:merchantId | Não montada | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/commerce/presentation/http/vtex-webhook.controller.ts:50](<../../../../../apps/api/src/modules/commerce/presentation/http/vtex-webhook.controller.ts#L50>) |
| POST /webhooks/woocommerce/:merchantId | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/commerce/presentation/http/woocommerce-webhook.controller.ts:48](<../../../../../apps/api/src/modules/commerce/presentation/http/woocommerce-webhook.controller.ts#L48>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
