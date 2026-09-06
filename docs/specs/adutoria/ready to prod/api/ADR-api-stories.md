# ADR — API / stories

> Implementação posterior na branch `fix/ready-to-prod-audit`: consultar [correções, evidências e pendências](../CORRECOES.md). O conteúdo abaixo preserva o retrato da auditoria original; o gate de produção continua aberto.


Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

CMS de categorias e stories públicos das lojas.

Inventário: 15 arquivos de implementação, 0 arquivos reconhecidos como testes, 607 linhas de implementação. 12 declarações HTTP; 12 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchant`, `story`, `storyCategory`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Ownership ignorado em repositório e categoria/story podem referenciar tenant diferente; zero testes do módulo encontrados.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 3/10 | 2/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Fluxos de criação/edição/arquivamento separados em use cases e rota pública de leitura.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| StoriesController | 188 | 13 | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:20](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L20>) |
| PrismaStoryRepository | 154 | 1 | [apps/api/src/modules/stories/infrastructure/repositories/prisma-story.repository.ts:5](<../../../../../apps/api/src/modules/stories/infrastructure/repositories/prisma-story.repository.ts#L5>) |
| StoriesModule | 25 | 0 | [apps/api/src/modules/stories/stories.module.ts:20](<../../../../../apps/api/src/modules/stories/stories.module.ts#L20>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-003](<ADR-api-stories.md#api-003>) (P0): Atualização e arquivamento ignoram o tenant recebido.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Isolamento de create/update/archive/reorder e projeção pública que não mistura lojas.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /story-manager/categories | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:41](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L41>) |
| POST /story-manager/categories | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:48](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L48>) |
| PATCH /story-manager/categories/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:63](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L63>) |
| DELETE /story-manager/categories/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:80](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L80>) |
| POST /story-manager/categories/reorder | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:88](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L88>) |
| GET /story-manager/categories/:categoryId/stories | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:101](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L101>) |
| POST /story-manager/categories/:categoryId/stories | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:108](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L108>) |
| PATCH /story-manager/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:126](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L126>) |
| DELETE /story-manager/:id | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:145](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L145>) |
| POST /story-manager/reorder | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:153](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L153>) |
| POST /story-manager/upload | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:166](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L166>) |
| GET /stores/:slug/stories | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/stories/presentation/http/stories.controller.ts:180](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L180>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-003"></a>

## API-003 — Atualização e arquivamento ignoram o tenant recebido

| Campo | Registro |
| --- | --- |
| ID | API-003 |
| SEVERITY | P0 |
| MODULE | stories |
| FILE(S) | [apps/api/src/modules/stories/infrastructure/repositories/prisma-story.repository.ts:34](<../../../../../apps/api/src/modules/stories/infrastructure/repositories/prisma-story.repository.ts#L34>)<br>[apps/api/src/modules/stories/infrastructure/repositories/prisma-story.repository.ts:101](<../../../../../apps/api/src/modules/stories/infrastructure/repositories/prisma-story.repository.ts#L101>)<br>[apps/api/src/modules/stories/presentation/http/stories.controller.ts:80](<../../../../../apps/api/src/modules/stories/presentation/http/stories.controller.ts#L80>) |
| ISSUE | Atualização e arquivamento ignoram o tenant recebido |
| EVIDENCE | Métodos de categorias e stories recebem merchantId, mas update/archive filtram somente id. Os use cases encaminham diretamente; Story e StoryCategory não constam na cobertura do middleware global. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Uma loja autenticada pode modificar ou arquivar conteúdo de outra loja com um ID conhecido. |
| ROOT CAUSE | Interface aparenta escopo multitenant, mas a implementação não o usa. |
| RECOMMENDED FIX | Adicionar tenant a todos os predicados e validar categoryId pertence ao mesmo merchant antes de criar/mover stories. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Cobrir update/archive/reorder/create com categorias/stories de duas lojas; nenhuma associação ou alteração cruzada pode persistir. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
