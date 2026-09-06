# ADR — API / installations

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Gerenciar instalação embed por loja, ambiente e origem.

Inventário: 6 arquivos de implementação, 1 arquivos reconhecidos como testes, 970 linhas de implementação. 6 declarações HTTP; 6 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchantInstallation`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

A segurança depende dos emissores sempre usarem instalação; no fluxo storefront ela é opcional. Controllers grandes concentram geração/configuração; zero prova de revogação em tokens já emitidos.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 6/10 | 7/10 | 4/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Normalização de origem, limite de origens, HTTPS em live e validação de instalação ativa/ambiente identificados.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| InstallationsController | 219 | 6 | [apps/api/src/modules/installations/presentation/http/installations.controller.ts:45](<../../../../../apps/api/src/modules/installations/presentation/http/installations.controller.ts#L45>) |
| PrismaInstallationRepository | 110 | 1 | [apps/api/src/modules/installations/infrastructure/prisma-installation.repository.ts:17](<../../../../../apps/api/src/modules/installations/infrastructure/prisma-installation.repository.ts#L17>) |
| ResolveInstallationForEmbedUseCase | 46 | 1 | [apps/api/src/modules/installations/application/installation.use-cases.ts:147](<../../../../../apps/api/src/modules/installations/application/installation.use-cases.ts#L147>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-044](<ADR-api-embed.md#api-044>) (P1): Emissão via storefront transforma parâmetros públicos em credencial de tenant.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Installation revogada, origem não permitida, ambiente test/live e emissor sem installation_id devem ter comportamento definido e testado.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /installations | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/installations/presentation/http/installations.controller.ts:60](<../../../../../apps/api/src/modules/installations/presentation/http/installations.controller.ts#L60>) |
| POST /installations | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/installations/presentation/http/installations.controller.ts:96](<../../../../../apps/api/src/modules/installations/presentation/http/installations.controller.ts#L96>) |
| GET /installations/:installationId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/installations/presentation/http/installations.controller.ts:127](<../../../../../apps/api/src/modules/installations/presentation/http/installations.controller.ts#L127>) |
| PUT /installations/:installationId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/installations/presentation/http/installations.controller.ts:151](<../../../../../apps/api/src/modules/installations/presentation/http/installations.controller.ts#L151>) |
| GET /installations/:installationId/health | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/installations/presentation/http/installations.controller.ts:191](<../../../../../apps/api/src/modules/installations/presentation/http/installations.controller.ts#L191>) |
| POST /installations/:installationId/health | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/installations/presentation/http/installations.controller.ts:234](<../../../../../apps/api/src/modules/installations/presentation/http/installations.controller.ts#L234>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
