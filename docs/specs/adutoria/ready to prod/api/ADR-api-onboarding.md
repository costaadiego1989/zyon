# ADR — API / onboarding

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Estado e progressão de ativação por merchant.

Inventário: 8 arquivos de implementação, 1 arquivos reconhecidos como testes, 431 linhas de implementação. 2 declarações HTTP; 2 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, merchant**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchantOnboardingState`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Estado e evento separados; taxonomia de steps da UI está divergente. Estado completed no browser não pode substituir validação do backend.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 8/10 | 6/10 | 7/10 | 7/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Valida merchant e step, entidade possui ordem/estado, há testes de use cases.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| OnboardingStateEntity | 89 | 1 | [apps/api/src/modules/onboarding/domain/entities/onboarding-state.entity.ts:49](<../../../../../apps/api/src/modules/onboarding/domain/entities/onboarding-state.entity.ts#L49>) |
| CompleteOnboardingStepUseCase | 71 | 3 | [apps/api/src/modules/onboarding/application/complete-onboarding-step.use-case.ts:50](<../../../../../apps/api/src/modules/onboarding/application/complete-onboarding-step.use-case.ts#L50>) |
| GetOnboardingStateUseCase | 25 | 1 | [apps/api/src/modules/onboarding/application/get-onboarding-state.use-case.ts:10](<../../../../../apps/api/src/modules/onboarding/application/get-onboarding-state.use-case.ts#L10>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-030](<ADR-api-onboarding.md#api-030>) (P2): Transição salva antes do evento pode suprimir retry.
- [DASH-001](<../dashboard/ADR-dashboard.md#dash-001>) (P1): Onboarding usa etapas incompatíveis e impede compilação.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Jornada de cada plano, retomada, ordem inválida e crash entre persistência/evento.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /onboarding | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/onboarding/presentation/http/onboarding.controller.ts:15](<../../../../../apps/api/src/modules/onboarding/presentation/http/onboarding.controller.ts#L15>) |
| POST /onboarding/steps/:step/complete | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/onboarding/presentation/http/onboarding.controller.ts:20](<../../../../../apps/api/src/modules/onboarding/presentation/http/onboarding.controller.ts#L20>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-030"></a>

## API-030 — Transição salva antes do evento pode suprimir retry

| Campo | Registro |
| --- | --- |
| ID | API-030 |
| SEVERITY | P2 |
| MODULE | onboarding |
| FILE(S) | [apps/api/src/modules/onboarding/application/complete-onboarding-step.use-case.ts:70](<../../../../../apps/api/src/modules/onboarding/application/complete-onboarding-step.use-case.ts#L70>) |
| ISSUE | Transição salva antes do evento pode suprimir retry |
| EVIDENCE | O estado é salvo antes de appendOutbox; retry com passo já concluído não publica a transição faltante. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Conclusão pode aparecer no dashboard sem ativar consumidores dependentes. |
| ROOT CAUSE | Idempotência baseada apenas no estado agregado, sem outbox atômico. |
| RECOMMENDED FIX | Salvar estado e evento em transação com ID estável da transição. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Injetar falha no outbox após save e repetir: um evento lógico precisa existir para cada mudança concluída. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
