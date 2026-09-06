# ADR — API / auth

**Atualização da segunda etapa:** ver [correções, contratos e evidências](../CORRECOES-ETAPA-2.md). O texto da auditoria abaixo preserva o retrato anterior; gates de produção continuam abertos.

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Autenticar merchants, emitir cookie/JWT, recuperar senha e renovar sessão.

Inventário: 27 arquivos de implementação, 9 arquivos reconhecidos como testes, 2098 linhas de implementação. 7 declarações HTTP; 7 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **notifications**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchant`, `merchantUser`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Refresh/reset/revogação não têm persistência distribuída consistente. Domínio inclui serviço de token específico da infraestrutura; ciclo de vida de timer de blacklist precisa ser encerrado.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 7/10 | 6/10 | 6/10 | 5/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

JWT usa assinatura HMAC com comparação segura, valida tenant/roles e rejeita audience buyer; segredo de desenvolvimento é recusado em production. Existem testes locais de JWT.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| AuthController | 275 | 7 | [apps/api/src/modules/auth/presentation/auth.controller.ts:25](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L25>) |
| PrismaAuthRepository | 174 | 1 | [apps/api/src/modules/auth/infrastructure/prisma-auth.repository.ts:41](<../../../../../apps/api/src/modules/auth/infrastructure/prisma-auth.repository.ts#L41>) |
| OAuthProviderAdapter | 165 | 0 | [apps/api/src/modules/auth/infrastructure/oauth-provider.adapter.ts:4](<../../../../../apps/api/src/modules/auth/infrastructure/oauth-provider.adapter.ts#L4>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-009](<ADR-api-auth.md#api-009>) (P1): Refresh reutiliza token expirado e revogação não é compartilhada.
- [API-010](<ADR-api-auth.md#api-010>) (P1): Recuperação de senha depende de memória local.
- [API-011](<ADR-api-team.md#api-011>) (P1): Papéis e remoção de membro não chegam ao principal de autenticação.
- [DASH-002](<../dashboard/ADR-dashboard.md#dash-002>) (P1): Configurações de conta chamam endpoints ausentes.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Revogação, refresh paralelo, logout, reset e remoção de membros devem funcionar em duas réplicas e após restart.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /auth/register | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/auth/presentation/auth.controller.ts:38](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L38>) |
| POST /auth/login | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/auth/presentation/auth.controller.ts:80](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L80>) |
| POST /auth/refresh | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/auth/presentation/auth.controller.ts:151](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L151>) |
| POST /auth/logout | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/auth/presentation/auth.controller.ts:195](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L195>) |
| POST /auth/forgot-password | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/auth/presentation/auth.controller.ts:209](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L209>) |
| POST /auth/reset-password | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/auth/presentation/auth.controller.ts:238](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L238>) |
| POST /auth/oauth/callback | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/auth/presentation/auth.controller.ts:273](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L273>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-009"></a>

## API-009 — Refresh reutiliza token expirado e revogação não é compartilhada

| Campo | Registro |
| --- | --- |
| ID | API-009 |
| SEVERITY | P1 |
| MODULE | auth |
| FILE(S) | [apps/api/src/modules/auth/domain/services/jwt.service.ts:47](<../../../../../apps/api/src/modules/auth/domain/services/jwt.service.ts#L47>)<br>[apps/api/src/modules/auth/application/refresh-token.use-case.ts:21](<../../../../../apps/api/src/modules/auth/application/refresh-token.use-case.ts#L21>) |
| ISSUE | Refresh reutiliza token expirado e revogação não é compartilhada |
| EVIDENCE | Refresh aceita expiração na janela de sete dias e revoga até decoded.exp. Para token já expirado, isTokenRevoked retorna falso porque expiry <= now. R01 conseguiu refresh duas vezes com o mesmo token. A blacklist é um Map local. |
| VERIFICATION | REPRODUCED_LOCAL R01; multi-réplica UNVERIFIED |
| PRODUCTION IMPACT | Replay após rotação; revogação não acompanha réplicas/restart. |
| ROOT CAUSE | Expiração da blacklist usa TTL do access token, embora o mesmo token ainda seja elegível a refresh. |
| RECOMMENDED FIX | Modelar refresh sessions persistidas, consumir por CAS, rotacionar/revogar a família e manter revogação durante toda a janela de refresh. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Mesmo token expirado só pode gerar um refresh; duas réplicas e dois requests paralelos devem obter um vencedor. Logout/reset/removal devem invalidar a sessão. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="api-010"></a>

## API-010 — Recuperação de senha depende de memória local

| Campo | Registro |
| --- | --- |
| ID | API-010 |
| SEVERITY | P1 |
| MODULE | auth |
| FILE(S) | [apps/api/src/modules/auth/infrastructure/prisma-auth.repository.ts:37](<../../../../../apps/api/src/modules/auth/infrastructure/prisma-auth.repository.ts#L37>)<br>[apps/api/src/modules/auth/infrastructure/prisma-auth.repository.ts:172](<../../../../../apps/api/src/modules/auth/infrastructure/prisma-auth.repository.ts#L172>)<br>[apps/api/src/modules/auth/presentation/auth.controller.ts:195](<../../../../../apps/api/src/modules/auth/presentation/auth.controller.ts#L195>) |
| ISSUE | Recuperação de senha depende de memória local |
| EVIDENCE | Mesmo o PrismaAuthRepository mantém tokens de reset em Map no processo; logout apenas limpa o cookie. Não há revogação compartilhada demonstrada após alteração de senha. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Link de reset pode falhar em outra réplica/restart; token previamente emitido pode continuar aceito. |
| ROOT CAUSE | Credenciais temporárias e revogação tratadas como cache descartável. |
| RECOMMENDED FIX | Persistir hash de token de uso único com TTL e consumedAt; invalidar sessões por versão do usuário/família na alteração de senha e logout. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Gerar reset na réplica A e concluir na B após restart; replay deve falhar; token anterior à troca de senha deve ser rejeitado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
