# ADR — API / support

> Implementação posterior na branch `fix/ready-to-prod-audit`: consultar [correções, evidências e pendências](../CORRECOES.md). O conteúdo abaixo preserva o retrato da auditoria original; o gate de produção continua aberto.


Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

FAQ, tickets, handoff e conversa com atendente.

Inventário: 28 arquivos de implementação, 15 arquivos reconhecidos como testes, 1786 linhas de implementação. 9 declarações HTTP; 9 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **embed, integrations**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `supportSetting`, `supportTicket`, `supportTicketMessage`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Gateway ignora esses controles e permite leitura/escrita anônima com IDs. Mutação de mensagem/status usa Prisma diretamente no caso de uso; transmissão precisa contrato de roles e recuperação.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 2/10 | 4/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

HTTP usa DTOs/EmbedAuthGuard para chat/FAQ e tenant credential/access para administração; consultas de ticket validam merchant.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| SupportController | 272 | 6 | [apps/api/src/modules/support/presentation/http/support.controller.ts:42](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L42>) |
| PrismaSupportTicketRepository | 120 | 1 | [apps/api/src/modules/support/infrastructure/prisma-support-ticket.repository.ts:20](<../../../../../apps/api/src/modules/support/infrastructure/prisma-support-ticket.repository.ts#L20>) |
| SupportGateway | 100 | 1 | [apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts:13](<../../../../../apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts#L13>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-041](<ADR-api-support.md#api-041>) (P0): Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação.
- [W2-009](<../widget_v2/ADR-widget_v2.md#w2-009>) (P2): Suporte responde políticas fixas em vez das configurações da loja.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Segurança do socket e HTTP com tenant/buyer distintos, reencontro de ticket após reconexão e idempotência de mensagem.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /support/tickets/:id/messages | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/support/presentation/http/support-messages.controller.ts:27](<../../../../../apps/api/src/modules/support/presentation/http/support-messages.controller.ts#L27>) |
| POST /support/tickets/:id/messages | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/support/presentation/http/support-messages.controller.ts:45](<../../../../../apps/api/src/modules/support/presentation/http/support-messages.controller.ts#L45>) |
| POST /support/chat | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/support/presentation/http/support.controller.ts:59](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L59>) |
| GET /support/faq | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/support/presentation/http/support.controller.ts:97](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L97>) |
| GET /support/settings | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/support/presentation/http/support.controller.ts:128](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L128>) |
| PUT /support/settings | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/support/presentation/http/support.controller.ts:158](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L158>) |
| GET /support/tickets | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/support/presentation/http/support.controller.ts:195](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L195>) |
| POST /support/tickets | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/support/presentation/http/support.controller.ts:241](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L241>) |
| PATCH /support/tickets/:ticketId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/support/presentation/http/support.controller.ts:275](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L275>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-041"></a>

## API-041 — Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação

| Campo | Registro |
| --- | --- |
| ID | API-041 |
| SEVERITY | P0 |
| MODULE | support |
| FILE(S) | [apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts:26](<../../../../../apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts#L26>)<br>[apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts:70](<../../../../../apps/api/src/modules/support/infrastructure/gateways/support.gateway.ts#L70>)<br>[apps/api/src/modules/support/application/send-ticket-message.use-case.ts:25](<../../../../../apps/api/src/modules/support/application/send-ticket-message.use-case.ts#L25>) |
| ISSUE | Gateway permite ouvir tickets e enviar mensagens como merchant sem autenticação |
| EVIDENCE | join_merchant e join_ticket aceitam IDs sem principal; send_message força senderType=merchant e usa merchantId recebido pelo socket. O use case verifica ticketId+merchantId, mas ambos vêm do cliente não autenticado. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Conhecendo IDs, qualquer conexão pode receber tickets/mensagens e se passar por atendente. Os guards dos controllers HTTP não cobrem o gateway. |
| ROOT CAUSE | Autorização de socket ausente e identidade do remetente controlada pelo cliente. |
| RECOMMENDED FIX | Autenticar conexão e validar membership/buyer-ticket em cada evento; derivar senderType e merchantId do principal; limitar conteúdo e frequência. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Socket anônimo/alheio não entra em sala nem envia mensagem; buyer não consegue assumir papel merchant mesmo enviando IDs válidos. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
