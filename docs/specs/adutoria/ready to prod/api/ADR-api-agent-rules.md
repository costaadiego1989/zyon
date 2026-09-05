# ADR — API / agent-rules

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Configurar políticas e contexto do agente por merchant.

Inventário: 12 arquivos de implementação, 4 arquivos reconhecidos como testes, 711 linhas de implementação. 6 declarações HTTP; 6 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, checkout-settings**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `agentRule`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Separação domínio/aplicação/repositório identificada. Principal risco é comportamento da política quando checkout/settings estão indisponíveis; não foi comprovado isolamento transacional entre edição e aplicação simultânea.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 8/10 | 7/10 | 7/10 | 7/10 | 5/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Entidade impõe invariantes de segurança e rejeita desabilitação de controles obrigatórios; contexto é exposto por porta e leitura de defaults não precisa gravar.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| AgentRulesEntity | 115 | 1 | [apps/api/src/modules/agent-rules/domain/entities/agent-rules.entity.ts:3](<../../../../../apps/api/src/modules/agent-rules/domain/entities/agent-rules.entity.ts#L3>) |
| AgentRulesController | 54 | 3 | [apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts:18](<../../../../../apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts#L18>) |
| AgentGuardrailsPatchDto | 50 | 0 | [apps/api/src/modules/agent-rules/presentation/http/dto/agent-rules-patch.dto.ts:79](<../../../../../apps/api/src/modules/agent-rules/presentation/http/dto/agent-rules-patch.dto.ts#L79>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-043](<ADR-api-checkout.md#api-043>) (P0): Preço e frete iniciais podem vir do cliente sem revalidação de catálogo.
- [API-038](<ADR-api-shared.md#api-038>) (P1): Gate de release não cobre o widget atual e falha localmente.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Testar regras por tenant, rollout de versão, edição concorrente e comportamento conservador quando contexto não puder ser carregado.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /agent-rules | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts:27](<../../../../../apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts#L27>) |
| PUT /agent-rules | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts:33](<../../../../../apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts#L33>) |
| GET /agent-rules/context | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts:43](<../../../../../apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts#L43>) |
| GET /agent-rules/:agentId | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts:49](<../../../../../apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts#L49>) |
| PUT /agent-rules/:agentId | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts:55](<../../../../../apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts#L55>) |
| GET /agent-rules/:agentId/context | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts:66](<../../../../../apps/api/src/modules/agent-rules/presentation/http/agent-rules.controller.ts#L66>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.



## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
