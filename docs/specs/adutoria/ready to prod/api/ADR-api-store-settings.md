# ADR — API / store-settings

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **CONDITIONAL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Configurar storefront e endereço público por slug.

Inventário: 7 arquivos de implementação, 0 arquivos reconhecidos como testes, 528 linhas de implementação. 10 declarações HTTP; 10 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, merchant**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchant`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Slug sem unicidade de banco; sobreposição com MerchantController precisa ser resolvida por porta de domínio. Não confundir publicação de config com domínio/DNS pronto.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 5/10 | 5/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Repositório/configuração por merchant com update de settings.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| StoreSettingsController | 124 | 6 | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:15](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L15>) |
| GenerateSeoSuggestionsUseCase | 114 | 1 | [apps/api/src/modules/store-settings/application/use-cases/generate-seo-suggestions.use-case.ts:32](<../../../../../apps/api/src/modules/store-settings/application/use-cases/generate-seo-suggestions.use-case.ts#L32>) |
| UpdateSeoSettingsUseCase | 82 | 1 | [apps/api/src/modules/store-settings/application/use-cases/update-seo-settings.use-case.ts:18](<../../../../../apps/api/src/modules/store-settings/application/use-cases/update-seo-settings.use-case.ts#L18>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-031](<ADR-api-store-settings.md#api-031>) (P2): Unicidade do slug depende de consulta sem constraint.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Slug concorrente, validação de settings, publicação/rollback e SSR do tenant correto.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /merchants/:mid/store-settings | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:27](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L27>) |
| PUT /merchants/:mid/store-settings | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:34](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L34>) |
| GET /merchants/me/store-settings/seo | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:45](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L45>) |
| PUT /merchants/me/store-settings/seo | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:52](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L52>) |
| POST /merchants/me/store-settings/seo/generate | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:62](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L62>) |
| GET /merchants/:mid/store-settings/seo | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:72](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L72>) |
| PUT /merchants/:mid/store-settings/seo | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:79](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L79>) |
| POST /merchants/:mid/store-settings/seo/generate | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:90](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L90>) |
| GET /merchants/me/cross-sell-config | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:101](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L101>) |
| PUT /merchants/me/cross-sell-config | Alcançável estaticamente | UseGuards(AuthGuard,RequirePlanGuard) | [apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts:110](<../../../../../apps/api/src/modules/store-settings/presentation/http/store-settings.controller.ts#L110>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-031"></a>

## API-031 — Unicidade do slug depende de consulta sem constraint

| Campo | Registro |
| --- | --- |
| ID | API-031 |
| SEVERITY | P2 |
| MODULE | store-settings |
| FILE(S) | [apps/api/src/modules/store-settings/application/use-cases/update-store-settings.use-case.ts:15](<../../../../../apps/api/src/modules/store-settings/application/use-cases/update-store-settings.use-case.ts#L15>)<br>[apps/api/src/modules/storefront/application/use-cases/get-store-config.use-case.ts:1](<../../../../../apps/api/src/modules/storefront/application/use-cases/get-store-config.use-case.ts#L1>) |
| ISSUE | Unicidade do slug depende de consulta sem constraint |
| EVIDENCE | Update procura slug já usado e depois grava JSON de configuração. Não foi encontrada constraint única de slug de loja; resolução de config também contém fallback que percorre merchants. |
| VERIFICATION | CONFIRMED_STATIC; migrações aplicadas UNVERIFIED |
| PRODUCTION IMPACT | Duas lojas podem escolher o mesmo slug simultaneamente; resolução pode tornar-se ambígua e cara. |
| ROOT CAUSE | Identificador público armazenado em JSON sem invariante de banco. |
| RECOMMENDED FIX | Promover slug normalizado a campo indexado único e tratar conflito transacional; resolver loja por consulta indexada. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Dois merchants concorrendo por slug normalizado geram um vencedor/409; lookup não percorre todas as lojas. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
