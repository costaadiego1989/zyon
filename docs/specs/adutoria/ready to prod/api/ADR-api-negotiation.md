# ADR — API / negotiation

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Políticas e motor de negociação, incluindo M2M e preferências buyer.

Inventário: 24 arquivos de implementação, 21 arquivos reconhecidos como testes, 2116 linhas de implementação. 19 declarações HTTP; 19 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, buyer-account, catalog, checkout, merchant, payment, shipping**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `buyerAgentNegotiationPreference`, `merchantNegotiationPolicy`, `negotiationCostLedgerEntry`, `negotiationSession`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

M2mController tem 13 dependências e cerca de 406 linhas, indicando mistura de protocolo/orquestração. Preço final depende das garantias de checkout/payment; saída de AI precisa permanecer subordinada ao motor determinístico.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 3/10 | 4/10 | 6/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Políticas/entidades e fingerprints possuem testes; persistência principal é Prisma e in-memory é usada para testes.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| M2mController | 406 | 13 | [apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:36](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts#L36>) |
| PrismaNegotiationStore | 210 | 1 | [apps/api/src/modules/negotiation/infrastructure/prisma-negotiation.store.ts:9](<../../../../../apps/api/src/modules/negotiation/infrastructure/prisma-negotiation.store.ts#L9>) |
| NegotiationController | 154 | 6 | [apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts:25](<../../../../../apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts#L25>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-043](<ADR-api-checkout.md#api-043>) (P0): Preço e frete iniciais podem vir do cliente sem revalidação de catálogo.
- [API-021](<ADR-api-coupons.md#api-021>) (P1): Limites de uso podem ser excedidos em sessões concorrentes.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Assinatura M2M, replay/nonce, limites de desconto, fingerprint de carrinho e aceite concorrente da oferta.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /buyer-agent/preferences | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/buyer-agent-negotiation-preferences.controller.ts:17](<../../../../../apps/api/src/modules/negotiation/presentation/http/buyer-agent-negotiation-preferences.controller.ts#L17>) |
| PUT /buyer-agent/preferences | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/buyer-agent-negotiation-preferences.controller.ts:33](<../../../../../apps/api/src/modules/negotiation/presentation/http/buyer-agent-negotiation-preferences.controller.ts#L33>) |
| GET /m2m/agents | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts:22](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts#L22>) |
| POST /m2m/agents | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts:29](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts#L29>) |
| PUT /m2m/agents/:id/suspend | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts:36](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts#L36>) |
| GET /m2m/protocol/config | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts:43](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts#L43>) |
| PUT /m2m/protocol/config | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts:49](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m-management.controller.ts#L49>) |
| POST /m2m/register | Alcançável estaticamente | UseGuards(M2mDualAuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:57](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts#L57>) |
| POST /m2m/discover | Alcançável estaticamente | UseGuards(M2mDualAuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:95](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts#L95>) |
| POST /m2m/negotiate | Alcançável estaticamente | UseGuards(M2mDualAuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:139](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts#L139>) |
| POST /m2m/quote | Alcançável estaticamente | UseGuards(M2mDualAuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:191](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts#L191>) |
| POST /m2m/checkout | Alcançável estaticamente | UseGuards(M2mDualAuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:261](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts#L261>) |
| GET /m2m/track/:orderId | Alcançável estaticamente | UseGuards(M2mDualAuthGuard) | [apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts:395](<../../../../../apps/api/src/modules/negotiation/presentation/http/m2m.controller.ts#L395>) |
| GET /merchant-negotiation-policy | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/merchant-negotiation-policy.controller.ts:17](<../../../../../apps/api/src/modules/negotiation/presentation/http/merchant-negotiation-policy.controller.ts#L17>) |
| PUT /merchant-negotiation-policy | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/merchant-negotiation-policy.controller.ts:27](<../../../../../apps/api/src/modules/negotiation/presentation/http/merchant-negotiation-policy.controller.ts#L27>) |
| POST /negotiations/evaluate | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts:37](<../../../../../apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts#L37>) |
| POST /negotiations/apply-checkout-offer | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts:81](<../../../../../apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts#L81>) |
| GET /negotiations/stats | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts:101](<../../../../../apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts#L101>) |
| GET /negotiations/sessions | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts:110](<../../../../../apps/api/src/modules/negotiation/presentation/http/negotiation.controller.ts#L110>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
