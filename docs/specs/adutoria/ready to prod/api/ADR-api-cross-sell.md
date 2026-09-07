# ADR — API / cross-sell

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Sugerir produto adicional, registrar aceite e integrar carrinho.

Inventário: 28 arquivos de implementação, 8 arquivos reconhecidos como testes, 1536 linhas de implementação. 7 declarações HTTP; 0 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, buyer-purchase-history, checkout, embed, merchant, payment**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `checkoutEvent`, `crossSellPromotion`, `crossSellSuggestion`, `merchant`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Domínio não é alcançado pela composição raiz e resolver de preço tem catálogo fixo. Ausência de endpoint ativo não equivale a capacidade concluída.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 5/10 | 4/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Entidade valida subconjunto de SKUs aceitos e existem portas de sugestão.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| ListEligibleCrossSellsUseCase | 133 | 4 | [apps/api/src/modules/cross-sell/application/use-cases/list-eligible-cross-sells.use-case.ts:26](<../../../../../apps/api/src/modules/cross-sell/application/use-cases/list-eligible-cross-sells.use-case.ts#L26>) |
| AcceptCrossSellSuggestionUseCase | 108 | 4 | [apps/api/src/modules/cross-sell/application/use-cases/accept-cross-sell-suggestion.use-case.ts:13](<../../../../../apps/api/src/modules/cross-sell/application/use-cases/accept-cross-sell-suggestion.use-case.ts#L13>) |
| AcceptCrossSellFromWidgetUseCase | 98 | 3 | [apps/api/src/modules/cross-sell/application/use-cases/accept-cross-sell-from-widget.use-case.ts:10](<../../../../../apps/api/src/modules/cross-sell/application/use-cases/accept-cross-sell-from-widget.use-case.ts#L10>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-035](<ADR-api-cross-sell.md#api-035>) (P2): cross-sell podia sugerir itens indisponíveis; correção local validada.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **validar em banco real disponibilidade, tenant e vínculo sugestão/sessão; publicar endpoint dedicado só com contrato versionado e consumidor integrado.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /merchant/cross-sell/promotions | Montada | UseGuards(AuthGuard); UseGuards(PlanLimitGuard) | [apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts:21](<../../../../../apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts#L21>) |
| GET /merchant/cross-sell/promotions | Montada | UseGuards(AuthGuard) | [apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts:37](<../../../../../apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts#L37>) |
| PUT /merchant/cross-sell/promotions/:id | Montada | UseGuards(AuthGuard) | [apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts:43](<../../../../../apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts#L43>) |
| DELETE /merchant/cross-sell/promotions/:id | Montada | UseGuards(AuthGuard) | [apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts:53](<../../../../../apps/api/src/modules/cross-sell/presentation/http/merchant-cross-sell.controller.ts#L53>) |
| POST /embed/cross-sell/suggest | Não montada | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/cross-sell/presentation/http/widget-cross-sell.controller.ts:19](<../../../../../apps/api/src/modules/cross-sell/presentation/http/widget-cross-sell.controller.ts#L19>) |
| POST /embed/cross-sell/accept | Não montada | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/cross-sell/presentation/http/widget-cross-sell.controller.ts:26](<../../../../../apps/api/src/modules/cross-sell/presentation/http/widget-cross-sell.controller.ts#L26>) |
| POST /embed/cross-sell/decline | Não montada | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/cross-sell/presentation/http/widget-cross-sell.controller.ts:41](<../../../../../apps/api/src/modules/cross-sell/presentation/http/widget-cross-sell.controller.ts#L41>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-035"></a>

## API-035 — Cross-sell podia sugerir itens indisponíveis

| Campo | Registro |
| --- | --- |
| ID | API-035 |
| SEVERITY | P2 |
| MODULE | cross-sell |
| FILE(S) | [apps/api/src/modules/cross-sell/application/services/cross-sell-product-resolver.ts:1](<../../../../../apps/api/src/modules/cross-sell/application/services/cross-sell-product-resolver.ts#L1>)<br>[apps/api/src/modules/cross-sell/application/use-cases/accept-cross-sell-from-widget.use-case.ts:70](<../../../../../apps/api/src/modules/cross-sell/application/use-cases/accept-cross-sell-from-widget.use-case.ts#L70>)<br>[apps/api/src/app.module.ts:1](<../../../../../apps/api/src/app.module.ts#L1>) |
| ISSUE | Cross-sell podia sugerir itens indisponíveis e o aceite dedicado não comprovava o vínculo com a sessão. |
| EVIDENCE | `CrossSellModule` é alcançável pelo `AppModule`; o widget usa sugestões do checkout, enquanto `WidgetCrossSellController` não entra nos controllers do módulo. O catálogo real já substitui fallbacks, mas faltavam filtros de ativo, exclusão e estoque líquido no recomendador. |
| VERIFICATION | IMPLEMENTED_LOCAL_VALIDATION |
| PRODUCTION IMPACT | Produto indisponível podia ser exibido antes de ser rejeitado no pagamento. O endpoint dedicado segue indisponível até ter consumidor e contrato versionado. |
| ROOT CAUSE | O recomendador não aplicava todos os invariantes comerciais do catálogo e a transição aceitava sugestão sem conferir sua sessão. |
| RECOMMENDED FIX | Filtrar pelo catálogo autoritativo, rejeitar aceite sem SKU vendável ou sessão correspondente, e publicar endpoint dedicado apenas com contrato versionado. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | Não para o fluxo atual; requer smoke em banco real |
| CRITÉRIO DE ACEITE | SKU desconhecido, inativo ou sem saldo não é sugerido/aceito; aceite respeita sessão, merchant, preço e estoque. Endpoint dedicado só é publicado com contrato e consumidor integrados. |

Decisão: manter o endpoint dedicado fora da superfície HTTP e operar o fluxo atual pelo checkout, agora com catálogo autoritativo. A validação local está concluída; o smoke com banco real continua obrigatório.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
