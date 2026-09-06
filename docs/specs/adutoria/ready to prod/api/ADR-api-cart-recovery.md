# ADR — API / cart-recovery

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Detectar abandono, escolher estratégia e enviar link de recuperação.

Inventário: 22 arquivos de implementação, 5 arquivos reconhecidos como testes, 1466 linhas de implementação. 11 declarações HTTP; 11 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, buyer-purchase-history, checkout, merchant, notifications**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `cartRecoveryStrategyPref`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Composição real usa tentativa em memória e envio fora de trabalho durável. Conversão recuperada precisa manter a sessão/carrinho original e consentimento, não apenas disparar WhatsApp.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 5/10 | 5/10 | 3/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Estratégias e métricas são separadas em casos de uso, e há identificação de tentativa por sessão.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| RecoveryScannerJob | 175 | 3 | [apps/api/src/modules/cart-recovery/infrastructure/jobs/recovery-scanner.job.ts:20](<../../../../../apps/api/src/modules/cart-recovery/infrastructure/jobs/recovery-scanner.job.ts#L20>) |
| CartRecoveryController | 111 | 4 | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts:94](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts#L94>) |
| CartRecoveryDashboardController | 109 | 5 | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts:23](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts#L23>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-019](<ADR-api-cart-recovery.md#api-019>) (P1): Deduplicação das tentativas de recuperação é volátil.
- [W2-001](<../widget_v2/ADR-widget_v2.md#w2-001>) (P1): Início não hidrata carrinho e identidade usados pelo pagamento.
- [API-024](<ADR-api-notifications.md#api-024>) (P1): Adaptadores retornam sucesso sem entrega confirmada.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Duplicidade em duas réplicas, restart, opt-out, TTL de link e retorno ao widget correto.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /dashboard/cart-recovery/metrics | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts:36](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts#L36>) |
| GET /dashboard/cart-recovery/attempts | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts:54](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts#L54>) |
| GET /dashboard/cart-recovery/strategies | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts:74](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts#L74>) |
| PATCH /dashboard/cart-recovery/strategies | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts:85](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts#L85>) |
| GET /dashboard/cart-recovery/config | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts:100](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts#L100>) |
| PATCH /dashboard/cart-recovery/config | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts:111](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery-dashboard.controller.ts#L111>) |
| GET /cart-recovery/metrics | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts:106](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts#L106>) |
| GET /cart-recovery/attempts | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts:124](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts#L124>) |
| GET /cart-recovery/strategies | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts:144](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts#L144>) |
| PATCH /cart-recovery/strategies | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts:155](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts#L155>) |
| POST /cart-recovery/test-send | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts:170](<../../../../../apps/api/src/modules/cart-recovery/presentation/http/cart-recovery.controller.ts#L170>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-019"></a>

## API-019 — Deduplicação das tentativas de recuperação é volátil

| Campo | Registro |
| --- | --- |
| ID | API-019 |
| SEVERITY | P1 |
| MODULE | cart-recovery |
| FILE(S) | [apps/api/src/modules/cart-recovery/cart-recovery.module.ts:45](<../../../../../apps/api/src/modules/cart-recovery/cart-recovery.module.ts#L45>)<br>[apps/api/src/modules/cart-recovery/application/use-cases/attempt-cart-recovery.use-case.ts:55](<../../../../../apps/api/src/modules/cart-recovery/application/use-cases/attempt-cart-recovery.use-case.ts#L55>) |
| ISSUE | Deduplicação das tentativas de recuperação é volátil |
| EVIDENCE | O módulo injeta Prisma, mas a factory retorna InMemoryRecoveryAttemptRepository. A tentativa é registrada localmente antes de envio assíncrono de WhatsApp com erro absorvido. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Restart ou múltiplas réplicas perdem histórico e podem reenviar mensagens; falha de envio pode ser tratada como tentativa consumida. |
| ROOT CAUSE | Repositório de teste permanece no wiring e envio não está em outbox transacional. |
| RECOMMENDED FIX | Persistir tentativa/chave de dedup e estado de envio com TTL/retry em banco; respeitar consentimento, janela e opt-out. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Duas réplicas avaliando o mesmo carrinho produzem uma tentativa; restart e falha do WhatsApp preservam histórico e possibilidade de retry. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
