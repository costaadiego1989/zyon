# ADR — API / buyer-account

**Atualização da segunda etapa:** ver [correções, contratos e evidências](../CORRECOES-ETAPA-2.md). O texto da auditoria abaixo preserva o retrato anterior; gates de produção continuam abertos.

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Conta global do comprador, identificação, OTP, perfil e compras.

Inventário: 62 arquivos de implementação, 14 arquivos reconhecidos como testes, 5161 linhas de implementação. 29 declarações HTTP; 25 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, buyer-purchase-history, checkout, integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `buyerAgentProfile`, `buyerPhoneOtp`, `buyerPurchaseRecord`, `completedOrder`, `merchant`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

OTP e reconhecimento no checkout cruzam este boundary. Fallback SMS não representa envio real; dados globais exigem prova atual de identidade antes de serem hidratados em sessão merchant.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 5/10 | 5/10 | 5/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há serviços separados de JWT buyer e persistência Prisma; principal do comprador é distinto do merchant.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| GetBuyerPurchasesUseCase | 192 | 5 | [apps/api/src/modules/buyer-account/application/use-cases/get-buyer-purchases.use-case.ts:53](<../../../../../apps/api/src/modules/buyer-account/application/use-cases/get-buyer-purchases.use-case.ts#L53>) |
| BuyerAccountController | 175 | 12 | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:29](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L29>) |
| PrismaBuyerConversationRepository | 172 | 1 | [apps/api/src/modules/buyer-account/infrastructure/prisma-buyer-conversation.repository.ts:18](<../../../../../apps/api/src/modules/buyer-account/infrastructure/prisma-buyer-conversation.repository.ts#L18>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-025](<ADR-api-buyer-account.md#api-025>) (P1): Fallback SMS registra OTP e simula envio.
- [API-042](<ADR-api-checkout.md#api-042>) (P0): E-mail conhecido é tratado como prova de identidade do comprador.
- [SF-005](<../storefront/ADR-storefront.md#sf-005>) (P1): Devolução do comprador chama controller não montado.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **OTP expirado/replay, enumeração de contas, buyer A/B e consulta multiloja precisam ser testados junto ao checkout.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /buyer/register | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:46](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L46>) |
| POST /buyer/login | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:54](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L54>) |
| POST /buyer/login-from-session | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:59](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L59>) |
| GET /buyer/me | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:73](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L73>) |
| PATCH /buyer/me/profile | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:88](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L88>) |
| PATCH /buyer/me/password | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:111](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L111>) |
| GET /buyer/me/purchases | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:126](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L126>) |
| GET /buyer/me/summary | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:171](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L171>) |
| POST /buyer/phone/send | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:184](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L184>) |
| POST /buyer/phone/verify | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:189](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L189>) |
| POST /buyer/email/send | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:194](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L194>) |
| POST /buyer/email/verify | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts:199](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-account.controller.ts#L199>) |
| GET /buyer/me/addresses | Não montada | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts:35](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts#L35>) |
| POST /buyer/me/addresses | Não montada | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts:44](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts#L44>) |
| PUT /buyer/me/addresses/:id | Não montada | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts:75](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts#L75>) |
| DELETE /buyer/me/addresses/:id | Não montada | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts:107](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-addresses.controller.ts#L107>) |
| GET /buyer/me/agent | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts:21](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts#L21>) |
| PUT /buyer/me/agent | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts:34](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts#L34>) |
| POST /buyer/me/agent/m2m/enable | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts:66](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts#L66>) |
| DELETE /buyer/me/agent/m2m/revoke | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts:72](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-agent.controller.ts#L72>) |
| GET /buyer/me/conversations | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts:38](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts#L38>) |
| GET /buyer/me/conversations/:id | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts:47](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts#L47>) |
| POST /buyer/me/conversations/:id/rate | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts:57](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts#L57>) |
| GET /buyer/me/export | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts:73](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts#L73>) |
| DELETE /buyer/me/account | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts:79](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-hub.controller.ts#L79>) |
| POST /buyer/webauthn/register/options | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts:30](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts#L30>) |
| POST /buyer/webauthn/register/verify | Alcançável estaticamente | UseGuards(BuyerJwtAuthGuard) | [apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts:41](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts#L41>) |
| POST /buyer/webauthn/login/options | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts:74](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts#L74>) |
| POST /buyer/webauthn/login/verify | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts:83](<../../../../../apps/api/src/modules/buyer-account/presentation/http/buyer-webauthn.controller.ts#L83>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-025"></a>

## API-025 — Fallback SMS registra OTP e simula envio

| Campo | Registro |
| --- | --- |
| ID | API-025 |
| SEVERITY | P1 |
| MODULE | buyer-account |
| FILE(S) | [apps/api/src/modules/buyer-account/buyer-account.module.ts:83](<../../../../../apps/api/src/modules/buyer-account/buyer-account.module.ts#L83>) |
| ISSUE | Fallback SMS registra OTP e simula envio |
| EVIDENCE | Na falta de BUBBLEWHATS configuração, o adaptador SMS do módulo registra a mensagem completa (incluindo código) e retorna sucesso. O envio configurado também não verifica response.ok. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Códigos de autenticação chegam a logs em vez do comprador; tentativas podem parecer enviadas e falhar silenciosamente. |
| ROOT CAUSE | Fallback de desenvolvimento no caminho de autenticação e contrato de entrega insuficiente. |
| RECOMMENDED FIX | Falhar configuração de SMS habilitado em production, redigir códigos/PII e validar status/timeout; retorno de API precisa representar disponibilidade do canal. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Em production sem provedor, nenhum OTP pode aparecer em logs; 4xx/5xx não conta como envio bem-sucedido. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
