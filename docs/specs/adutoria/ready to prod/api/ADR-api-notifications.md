# ADR — API / notifications

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Enviar mensagens transacionais de pedido/entrega/devolução.

Inventário: 16 arquivos de implementação, 0 arquivos reconhecidos como testes, 1029 linhas de implementação. 0 declarações HTTP; 0 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Nenhum import intermodular TypeScript extraído neste diretório.

O extrator não reconheceu acessos Prisma diretos; isso não comprova ausência de persistência indireta/SQL.

Adaptadores absorvem falha/fingem sucesso sem configuração; há envio direto também dentro de checkout, duplicando responsabilidade.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 5/10 | 5/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Casos de uso e portas de canal são separados da regra de negócio.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| NotificationListener | 71 | 5 | [apps/api/src/modules/notifications/presentation/listeners/notification.listener.ts:18](<../../../../../apps/api/src/modules/notifications/presentation/listeners/notification.listener.ts#L18>) |
| ResendEmailAdapter | 55 | 0 | [apps/api/src/modules/notifications/infrastructure/adapters/resend-email.adapter.ts:24](<../../../../../apps/api/src/modules/notifications/infrastructure/adapters/resend-email.adapter.ts#L24>) |
| BubbleWhatsAdapter | 46 | 0 | [apps/api/src/modules/notifications/infrastructure/adapters/bubblewhats.adapter.ts:4](<../../../../../apps/api/src/modules/notifications/infrastructure/adapters/bubblewhats.adapter.ts#L4>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-024](<ADR-api-notifications.md#api-024>) (P1): Adaptadores retornam sucesso sem entrega confirmada.
- [API-016](<ADR-api-shared.md#api-016>) (P1): Claim do outbox não conserva exclusividade até o processamento.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Um dono de envio por evento, receipt idempotente, deadline/retry/backoff, redaction e dead-letter operável.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

Nenhuma rota HTTP declarada; avaliar consumo interno, eventos/jobs ou ausência de wiring.

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-024"></a>

## API-024 — Adaptadores retornam sucesso sem entrega confirmada

| Campo | Registro |
| --- | --- |
| ID | API-024 |
| SEVERITY | P1 |
| MODULE | notifications |
| FILE(S) | [apps/api/src/modules/notifications/infrastructure/adapters/bubblewhats.adapter.ts:1](<../../../../../apps/api/src/modules/notifications/infrastructure/adapters/bubblewhats.adapter.ts#L1>)<br>[apps/api/src/modules/notifications/infrastructure/adapters/resend-email.adapter.ts:25](<../../../../../apps/api/src/modules/notifications/infrastructure/adapters/resend-email.adapter.ts#L25>) |
| ISSUE | Adaptadores retornam sucesso sem entrega confirmada |
| EVIDENCE | BubbleWhats absorve resposta não OK e exceções; Resend sem chave retorna identificador de fila simulado. Caminhos de envio não aplicam timeout explícito. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Eventos podem ser marcados entregues sem mensagem enviada e sem retry; falta de configuração não impede falso sucesso. |
| ROOT CAUSE | Contrato de adaptador não distingue accepted/failed/not-configured. |
| RECOMMENDED FIX | Validar configuração no startup do canal habilitado, aplicar deadline e propagar erro retryable; registrar receipt/status durável. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | HTTP 500/429/timeout e chave ausente devem impedir delivered; retry gera um envio idempotente e métrica/alerta de falha. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

### Atualização pós-auditoria — 2026-09-06

O commit `b67e320` passou a distinguir aceite, configuração ausente e falha de transporte nos adaptadores. Esta correção completa o uso desse contrato nas quatro notificações transacionais: confirmação, envio, entrega e devolução aprovada agora passam `requireDelivery: true`; portanto, o fallback de desenvolvimento não pode ser tratado como entrega. BubbleWhats também recebeu deadline de 15 segundos.

Os testes focalizados cobrem configuração ausente, aceite com identificador de provedor, identificador ausente, HTTP 503, falha de transporte, timeout e o uso obrigatório do modo estrito por todos os quatro casos de uso. A compilação da API passou. Esses testes validam a decisão local do adaptador; não verificam credenciais, entrega real nem métricas em produção.

O status de API-024 passa para `IMPLEMENTED_LOCAL_VALIDATION`. O gate permanece aberto: retry idempotente, recibo persistido, alerta e a exclusividade do outbox dependem das pendências de mensageria, especialmente API-016.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
