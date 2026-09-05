# ADR — API / team

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Membros, convites, papéis e remoção de equipe.

Inventário: 7 arquivos de implementação, 0 arquivos reconhecidos como testes, 560 linhas de implementação. 5 declarações HTTP; 5 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, notifications**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchant`, `merchantInvite`, `merchantTeamMember`, `merchantUser`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Fonte de autenticação não acompanha membership; papéis em caixas/valores diferentes. Convite com provisionamento automático deve ter ativação e consumo de token definidos.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 4/10 | 4/10 | 3/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Há guards administrativos e casos de uso separados por comando.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| InviteMemberUseCase | 147 | 2 | [apps/api/src/modules/team/application/use-cases/invite-member.use-case.ts:37](<../../../../../apps/api/src/modules/team/application/use-cases/invite-member.use-case.ts#L37>) |
| TeamController | 79 | 5 | [apps/api/src/modules/team/presentation/http/team.controller.ts:27](<../../../../../apps/api/src/modules/team/presentation/http/team.controller.ts#L27>) |
| AcceptInviteUseCase | 45 | 1 | [apps/api/src/modules/team/application/use-cases/accept-invite.use-case.ts:23](<../../../../../apps/api/src/modules/team/application/use-cases/accept-invite.use-case.ts#L23>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-011](<ADR-api-team.md#api-011>) (P1): Papéis e remoção de membro não chegam ao principal de autenticação.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Convite, aceitação, expiração, role change e revogação efetiva em todas as sessões/réplicas.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /merchants/:merchantId/team | Alcançável estaticamente | UseGuards(AuthGuard,TenantRoleGuard) | [apps/api/src/modules/team/presentation/http/team.controller.ts:38](<../../../../../apps/api/src/modules/team/presentation/http/team.controller.ts#L38>) |
| POST /merchants/:merchantId/team/invite | Alcançável estaticamente | UseGuards(AuthGuard,TenantRoleGuard); RequireTenantRoles("owner","admin") | [apps/api/src/modules/team/presentation/http/team.controller.ts:43](<../../../../../apps/api/src/modules/team/presentation/http/team.controller.ts#L43>) |
| POST /merchants/:merchantId/team/accept | Alcançável estaticamente | UseGuards(AuthGuard,TenantRoleGuard) | [apps/api/src/modules/team/presentation/http/team.controller.ts:61](<../../../../../apps/api/src/modules/team/presentation/http/team.controller.ts#L61>) |
| PUT /merchants/:merchantId/team/:userId/role | Alcançável estaticamente | UseGuards(AuthGuard,TenantRoleGuard); RequireTenantRoles("owner","admin") | [apps/api/src/modules/team/presentation/http/team.controller.ts:76](<../../../../../apps/api/src/modules/team/presentation/http/team.controller.ts#L76>) |
| DELETE /merchants/:merchantId/team/:userId | Alcançável estaticamente | UseGuards(AuthGuard,TenantRoleGuard); RequireTenantRoles("owner","admin") | [apps/api/src/modules/team/presentation/http/team.controller.ts:93](<../../../../../apps/api/src/modules/team/presentation/http/team.controller.ts#L93>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-011"></a>

## API-011 — Papéis e remoção de membro não chegam ao principal de autenticação

| Campo | Registro |
| --- | --- |
| ID | API-011 |
| SEVERITY | P1 |
| MODULE | team |
| FILE(S) | [apps/api/src/modules/team/application/use-cases/invite-member.use-case.ts:1](<../../../../../apps/api/src/modules/team/application/use-cases/invite-member.use-case.ts#L1>)<br>[apps/api/src/modules/team/application/use-cases/update-role.use-case.ts:1](<../../../../../apps/api/src/modules/team/application/use-cases/update-role.use-case.ts#L1>)<br>[apps/api/src/modules/team/application/use-cases/remove-member.use-case.ts:1](<../../../../../apps/api/src/modules/team/application/use-cases/remove-member.use-case.ts#L1>)<br>[apps/api/src/modules/auth/domain/services/jwt.service.ts:15](<../../../../../apps/api/src/modules/auth/domain/services/jwt.service.ts#L15>) |
| ISSUE | Papéis e remoção de membro não chegam ao principal de autenticação |
| EVIDENCE | Convite grava MerchantUser.role com OWNER/ADMIN/STAFF; JwtService aceita somente owner/admin. Alterar papel/remover membro opera MerchantTeamMember, sem atualizar/revogar o MerchantUser usado no login. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Novos membros podem receber token rejeitado e membros removidos podem conservar acesso através de conta/token existente. |
| ROOT CAUSE | Dois modelos de associação e duas taxonomias de papel sem fonte de verdade única. |
| RECOMMENDED FIX | Unificar papéis e membership efetiva; atualizar associação/credencial em transação e invalidar sessões na remoção/redução de privilégio. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Convidar cada papel, entrar, reduzir privilégio, remover e tentar usar token antigo/novo em todas as réplicas. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
