# ADR — API / audit

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Registrar e consultar trilha de mutações administrativas.

Inventário: 11 arquivos de implementação, 2 arquivos reconhecidos como testes, 675 linhas de implementação. 1 declarações HTTP; 1 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchantAuditEvent`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

O módulo observa HTTP, mas não participa do commit que precisa auditar. Eventos financeiros internos e ações via socket precisam ter cobertura explícita; contagem de arquivos de teste não prova completude da trilha.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 6/10 | 6/10 | 7/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há repositório persistido e consulta por tenant; interceptor centraliza coleta do ator/recurso.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| AuditMutationInterceptor | 99 | 2 | [apps/api/src/modules/audit/infrastructure/audit-mutation.interceptor.ts:19](<../../../../../apps/api/src/modules/audit/infrastructure/audit-mutation.interceptor.ts#L19>) |
| PrismaAuditRepository | 72 | 1 | [apps/api/src/modules/audit/infrastructure/prisma-audit.repository.ts:9](<../../../../../apps/api/src/modules/audit/infrastructure/prisma-audit.repository.ts#L9>) |
| InMemoryAuditRepository | 47 | 0 | [apps/api/src/modules/audit/infrastructure/in-memory-audit.repository.ts:11](<../../../../../apps/api/src/modules/audit/infrastructure/in-memory-audit.repository.ts#L11>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-028](<ADR-api-audit.md#api-028>) (P2): Trilha de auditoria é gravada fora do commit da mutação.
- [API-041](<ADR-api-support.md#api-041>) (P0): Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Reconciliar mutações críticas com eventos de audit, incluindo falha/retry, e validar redaction/retention.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /audit-events | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/audit/presentation/http/audit-events.controller.ts:31](<../../../../../apps/api/src/modules/audit/presentation/http/audit-events.controller.ts#L31>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-028"></a>

## API-028 — Trilha de auditoria é gravada fora do commit da mutação

| Campo | Registro |
| --- | --- |
| ID | API-028 |
| SEVERITY | P2 |
| MODULE | audit |
| FILE(S) | [apps/api/src/modules/audit/infrastructure/audit-mutation.interceptor.ts:55](<../../../../../apps/api/src/modules/audit/infrastructure/audit-mutation.interceptor.ts#L55>) |
| ISSUE | Trilha de auditoria é gravada fora do commit da mutação |
| EVIDENCE | Interceptor usa tap e inicia void recordAudit após resposta de sucesso, capturando erro somente em log. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Uma alteração financeira/administrativa pode persistir sem evento de auditoria após crash ou erro de armazenamento. |
| ROOT CAUSE | Trilha durável implementada como observação best-effort da resposta HTTP. |
| RECOMMENDED FIX | Para ações críticas, gravar evento de auditoria/outbox no mesmo commit da mutação e vincular ator, tenant, recurso e correlationId. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Falha no registro de audit não pode criar mutação crítica sem trilha; retries devem conservar um evento lógico e não registrar segredos. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
