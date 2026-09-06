# ADR — API / infraestrutura compartilhada

**Atualização da segunda etapa:** ver [correções, contratos e evidências](../CORRECOES-ETAPA-2.md). O texto da auditoria abaixo preserva o retrato anterior; gates de produção continuam abertos.

Data: 2026-09-05. Status: auditoria registrada; correções propostas. Veredito: **FAIL**.

Responsabilidade: HTTP, tenant context, persistência, outbox, caches, observabilidade, saúde e implantação. Estes componentes afetam todos os módulos; não são um domínio adicional de negócio.

[Índice](<../README.md>) · [Arquitetura](<../ARQUITETURA.md>) · [Decisão de mensageria](<../ADR-ASYNC.md>)

Há controles existentes: ValidationPipe, ProblemDetails, correlation ID, liveness/readiness, timeout HTTP, Prisma, outbox persistido e interceptação de idempotência. Sua presença não neutraliza falhas de autoria, claims, configuração ou resiliência. Especificar fronteira de transação e dono de efeito antes de ampliar retries.

<a id="api-016"></a>

## API-016 — Claim do outbox não conserva exclusividade até o processamento

| Campo | Registro |
| --- | --- |
| ID | API-016 |
| SEVERITY | P1 |
| MODULE | shared |
| FILE(S) | [apps/api/src/shared/messaging/infrastructure/prisma-outbox.repository.ts:45](<../../../../../apps/api/src/shared/messaging/infrastructure/prisma-outbox.repository.ts#L45>)<br>[apps/api/src/shared/messaging/outbox-dispatcher.service.ts:1](<../../../../../apps/api/src/shared/messaging/outbox-dispatcher.service.ts#L1>) |
| ISSUE | Claim do outbox não conserva exclusividade até o processamento |
| EVIDENCE | claimBatch executa SELECT FOR UPDATE SKIP LOCKED sem transação durando até uma marcação de claim/lease. Após a consulta, o evento segue pending. O dispatcher consulta dedup, executa handler e só então marca processamento. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Réplicas podem executar o mesmo efeito. Crash após efeito e antes do marker também permite duplicação. Marcar handler após envio externo não produz exactly-once. |
| ROOT CAUSE | Lock de consulta confundido com reserva durável do trabalho; dedup depende de check-then-act. |
| RECOMMENDED FIX | Claim atômico com owner/lease/attempt e retorno das linhas; handlers idempotentes por chave de negócio e outbox transacional. Não manter transação aberta durante HTTP externo. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Dois dispatchers devem compartilhar lote sem processamento concorrente indevido; matar worker após efeito e antes do ack não pode duplicar cobrança/estoque. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-027"></a>

## API-027 — Rate limiter global pode liberar todas as requisições

| Campo | Registro |
| --- | --- |
| ID | API-027 |
| SEVERITY | P1 |
| MODULE | shared |
| FILE(S) | [apps/api/src/shared/http/rate-limit.guard.ts:1](<../../../../../apps/api/src/shared/http/rate-limit.guard.ts#L1>) |
| ISSUE | Rate limiter global pode liberar todas as requisições |
| EVIDENCE | O guard tenta require("ioredis") em aplicação ESM, captura falha e mantém construtor nulo; sem Redis/client ou sem principal retorna true. Como APP_GUARD antecede guard de rota, o principal também pode ainda não estar atribuído. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | O limitador global por tenant não é controle confiável contra abuso. Há outro RateLimitModule e regras Kong; isso não prova que todos os endpoints estejam ilimitados. |
| ROOT CAUSE | Carregamento incompatível com ESM e dependência da ordem de autenticação. |
| RECOMMENDED FIX | Usar import suportado, definir autenticação antes de quotas de tenant, limitar entradas anônimas por chave apropriada e estabelecer política para Redis indisponível. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Com Redis real, validar 429 após limite por tenant/IP em duas réplicas, inclusive sem cookie; comparar proteção dentro e fora do gateway. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-038"></a>

## API-038 — Gate de release não cobre o widget atual e falha localmente

| Campo | Registro |
| --- | --- |
| ID | API-038 |
| SEVERITY | P1 |
| MODULE | shared |
| FILE(S) | [.github/workflows/ci.yml:30](<../../../../../.github/workflows/ci.yml#L30>)<br>[.github/workflows/live.yml:35](<../../../../../.github/workflows/live.yml#L35>)<br>[apps/api/package.json:1](<../../../../../apps/api/package.json#L1>) |
| ISSUE | Gate de release não cobre o widget atual e falha localmente |
| EVIDENCE | CI referencia apps/widget removido nesta árvore; live.yml usa filtros @aacp e widget antigos. Typecheck API falha por minimatch; diagnóstico --types node revela Prisma Client local sem tipos gerados válidos. Esses erros de ambiente não provam falha do código no deploy. |
| VERIFICATION | EXECUTED_FAILED + CONFIRMED_STATIC |
| PRODUCTION IMPACT | O pipeline presente não fornece evidência de build/test do widget_v2 e storefront; baseline da API não foi validado. |
| ROOT CAUSE | CI desatualizado em relação aos workspaces e ambiente local de geração/tipagem inconsistente. |
| RECOMMENDED FIX | Atualizar matriz dos quatro apps, gerar Prisma/artefatos na ordem correta e executar install frozen/build/typecheck/test/smoke em ambiente limpo. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Baixo |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Pipeline deve falhar se qualquer um dos quatro apps falhar, e publicar evidência do mesmo commit/lockfile que será implantado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-039"></a>

## API-039 — Auditoria de dependências retornou avisos de segurança pendentes

| Campo | Registro |
| --- | --- |
| ID | API-039 |
| SEVERITY | P1 |
| MODULE | shared |
| FILE(S) | [pnpm-lock.yaml:1](<../../../../../pnpm-lock.yaml#L1>) |
| ISSUE | Auditoria de dependências retornou avisos de segurança pendentes |
| EVIDENCE | pnpm audit --prod --json retornou exit 1: 78 ocorrências reportadas (35 high, 39 moderate, 4 low, 0 critical) em 768 dependências. O relatório preserva advisory IDs e caminhos; contagem não equivale a 78 vulnerabilidades exploráveis. |
| VERIFICATION | EXECUTED; exploitability UNVERIFIED |
| PRODUCTION IMPACT | Release exige triagem de alcançabilidade e atualização das dependências afetadas. Exemplos reportados incluem multer, ws, protobufjs, undici e sharp. |
| ROOT CAUSE | Lockfile contém versões listadas por advisories atuais; uso efetivo por rota ainda precisa ser triado. |
| RECOMMENDED FIX | Priorizar bibliotecas alcançáveis por input externo, atualizar versões compatíveis e registrar exceções justificadas com prazo; repetir audit no artefato final. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Nenhum high/critical alcançável sem mitigação comprovada; SBOM e audit do lockfile final anexados à release. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-045"></a>

## API-045 — Compose de produção referencia Dockerfile ausente do storefront

| Campo | Registro |
| --- | --- |
| ID | API-045 |
| SEVERITY | P1 |
| MODULE | shared |
| FILE(S) | [docker-compose.production.yml:110](<../../../../../docker-compose.production.yml#L110>)<br>[apps/storefront/next.config.ts:1](<../../../../../apps/storefront/next.config.ts#L1>) |
| ISSUE | Compose de produção referencia Dockerfile ausente do storefront |
| EVIDENCE | Serviço storefront declara apps/storefront/Dockerfile, arquivo inexistente na árvore. Também injeta NEXT_PUBLIC_API_URL, mas o client/config usa NEXT_PUBLIC_API_BASE_URL/AACP_API_URL; variáveis públicas são incorporadas no build Next. |
| VERIFICATION | CONFIRMED_STATIC; deploy não executado |
| PRODUCTION IMPACT | Build completo por esse compose falha e configuração pretendida não corresponde ao código. Deploy Vercel é outra via e não foi exercitado. |
| ROOT CAUSE | Manifesto de implantação não acompanha artefatos e nomes de configuração atuais. |
| RECOMMENDED FIX | Criar/validar artefato de deploy escolhido com variáveis corretas em build/runtime e smoke de SSR/browser; manter uma receita oficial reproduzível. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Build em checkout limpo e subida do compose completo ou pipeline oficial escolhido passam /ready e loja pública chama a origem correta. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-037"></a>

## API-037 — Shutdown e backpressure do outbox não aguardam trabalho em curso

| Campo | Registro |
| --- | --- |
| ID | API-037 |
| SEVERITY | P2 |
| MODULE | shared |
| FILE(S) | [apps/api/src/shared/messaging/outbox-dispatcher.service.ts:20](<../../../../../apps/api/src/shared/messaging/outbox-dispatcher.service.ts#L20>) |
| ISSUE | Shutdown e backpressure do outbox não aguardam trabalho em curso |
| EVIDENCE | onModuleDestroy limpa timer; não aguarda explicitamente processamento em curso. O polling usa proteção local e não representa lease entre réplicas. |
| VERIFICATION | CONFIRMED_STATIC; REQUIRES LOAD VALIDATION |
| PRODUCTION IMPACT | Deploy pode interromper handlers após efeito externo e antes do ack; backlog cresce sem capacidade/latência validada. |
| ROOT CAUSE | Lifecycle controla scheduler, mas não o estado dos trabalhos distribuídos. |
| RECOMMENDED FIX | Parar novos claims, aguardar/drain com deadline, liberar lease recuperável e monitorar oldest_pending, attempts/dead e tempo de handler. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | SIGTERM durante handler não perde evento; backlog com provedor lento permanece limitado e dispara alerta. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.
