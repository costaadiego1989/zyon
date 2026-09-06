# ADR — API / intent-memory

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Consentimento e classificação de intenção do comprador.

Inventário: 7 arquivos de implementação, 6 arquivos reconhecidos como testes, 423 linhas de implementação. 4 declarações HTTP; 4 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `customerIntentRecord`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Ambos repositórios escolhidos são voláteis. Classificação precisa informar versão/fonte e não assumir consentimento ausente ou herdado entre lojas.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 5/10 | 2/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Use case consulta consentimento antes de gravar intenção; entidade representa ativação/revogação.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| ClassifyCustomerIntentUseCase | 94 | 1 | [apps/api/src/modules/intent-memory/application/use-cases/classify-customer-intent.use-case.ts:11](<../../../../../apps/api/src/modules/intent-memory/application/use-cases/classify-customer-intent.use-case.ts#L11>) |
| IntentMemoryController | 93 | 3 | [apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts:22](<../../../../../apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts#L22>) |
| BuyerIntentMemoryConsentEntity | 38 | 1 | [apps/api/src/modules/intent-memory/domain/entities/buyer-intent-memory-consent.entity.ts:11](<../../../../../apps/api/src/modules/intent-memory/domain/entities/buyer-intent-memory-consent.entity.ts#L11>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-020](<ADR-api-intent-memory.md#api-020>) (P1): Consentimento e memória de intenção usam repositórios em memória.
- [API-042](<ADR-api-checkout.md#api-042>) (P0): E-mail conhecido é tratado como prova de identidade do comprador.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Persistência e expurgo verificável, revogação entre réplicas e não processamento quando consentimento está ausente.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /intent-memory/me | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts:33](<../../../../../apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts#L33>) |
| POST /intent-memory/classify | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts:47](<../../../../../apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts#L47>) |
| POST /intent-memory/record | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts:69](<../../../../../apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts#L69>) |
| GET /intent-memory/records | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts:94](<../../../../../apps/api/src/modules/intent-memory/presentation/http/intent-memory.controller.ts#L94>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-020"></a>

## API-020 — Consentimento e memória de intenção usam repositórios em memória

| Campo | Registro |
| --- | --- |
| ID | API-020 |
| SEVERITY | P1 |
| MODULE | intent-memory |
| FILE(S) | [apps/api/src/modules/intent-memory/intent-memory.module.ts:15](<../../../../../apps/api/src/modules/intent-memory/intent-memory.module.ts#L15>)<br>[apps/api/src/modules/intent-memory/application/use-cases/classify-customer-intent.use-case.ts:118](<../../../../../apps/api/src/modules/intent-memory/application/use-cases/classify-customer-intent.use-case.ts#L118>) |
| ISSUE | Consentimento e memória de intenção usam repositórios em memória |
| EVIDENCE | A composição escolhe InMemoryIntentMemoryRepository e InMemoryBuyerIntentConsentRepository. A verificação de consentimento existe, porém consulta esse estado local. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Consentimento/revogação e registros divergem entre réplicas e desaparecem em restart. Não é possível comprovar política durável de uso/exclusão por buyer. |
| ROOT CAUSE | Persistência de consentimento confundida com cache. |
| RECOMMENDED FIX | Persistir consentimentos versionados e revogações com escopo e retenção definidos; fazer todas as leituras/expurgos respeitarem a fonte única. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Conceder em A, ler e revogar em B, reiniciar ambas: registro de intenção novo deve obedecer à revogação e exclusão deve ser verificável. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
