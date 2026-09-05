# ADR — API / scraping-agent

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **CONDITIONAL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Extrair conteúdo externo e estruturar dados para onboarding/catálogo.

Inventário: 17 arquivos de implementação, 9 arquivos reconhecidos como testes, 703 linhas de implementação. 4 declarações HTTP; 0 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **embed**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `priceQuoteJob`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Capacidade dormente não foi exercitada em runtime. Antes de expor, validar URL/redirect/DNS privado, tamanho de página, timeout, custo e tratamento de conteúdo não confiável.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 6/10 | 6/10 | 6/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há domínio/portas e nove arquivos de teste identificados; módulo não é alcançado pelo AppModule.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| PriceQuoteJobEntity | 90 | 1 | [apps/api/src/modules/scraping-agent/domain/entities/price-quote-job.entity.ts:43](<../../../../../apps/api/src/modules/scraping-agent/domain/entities/price-quote-job.entity.ts#L43>) |
| WidgetPriceQuoteController | 77 | 4 | [apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts:20](<../../../../../apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts#L20>) |
| PrismaPriceQuoteJobRepository | 70 | 1 | [apps/api/src/modules/scraping-agent/infrastructure/repositories/prisma-price-quote-job.repository.ts:6](<../../../../../apps/api/src/modules/scraping-agent/infrastructure/repositories/prisma-price-quote-job.repository.ts#L6>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

Nenhum P0/P1 específico foi confirmado na amostra deste módulo. O estado permanece CONDITIONAL por falta de prova de runtime, carga e recuperação.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **SSRF, páginas enormes/lentas, redirect privado, parsing malformado e ingestão sem atribuir autoridade de regra ao conteúdo externo.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /embed/price-quote | Não montada | UseGuards(EmbedAuthGuard); Idempotent() | [apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts:31](<../../../../../apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts#L31>) |
| GET /embed/price-quote/:job_id | Não montada | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts:60](<../../../../../apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts#L60>) |
| DELETE /embed/price-quote/:job_id | Não montada | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts:73](<../../../../../apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts#L73>) |
| POST /embed/price-quote/:job_id/finalize | Não montada | UseGuards(EmbedAuthGuard); Idempotent() | [apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts:80](<../../../../../apps/api/src/modules/scraping-agent/presentation/http/widget-price-quote.controller.ts#L80>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
