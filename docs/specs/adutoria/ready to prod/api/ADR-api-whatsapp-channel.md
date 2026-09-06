# ADR — API / whatsapp-channel

**Atualização da segunda etapa:** ver [correções, contratos e evidências](../CORRECOES-ETAPA-2.md). O texto da auditoria abaixo preserva o retrato anterior; gates de produção continuam abertos.

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Configurar canal, receber mensagens/status e conduzir conversa WhatsApp.

Inventário: 22 arquivos de implementação, 0 arquivos reconhecidos como testes, 3261 linhas de implementação. 10 declarações HTTP; 10 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `buyerIdentity`, `checkoutSession`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Canal BubbleWhats admite segredo opcional e acknowledge antes de processamento durável. ConfigureWhatsAppUseCase extenso reúne credenciais/provisionamento; callbacks precisam tenant resolvido por instalação confiável.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 5/10 | 4/10 | 4/10 | 5/10 | 2/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Providers distintos e serviços de dedup/debounce identificados; alguns caminhos validam assinatura do provedor.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| ConfigureWhatsAppUseCase | 394 | 1 | [apps/api/src/modules/whatsapp-channel/application/use-cases/configure-whatsapp.use-case.ts:42](<../../../../../apps/api/src/modules/whatsapp-channel/application/use-cases/configure-whatsapp.use-case.ts#L42>) |
| HandleIncomingMessageUseCase | 239 | 4 | [apps/api/src/modules/whatsapp-channel/application/use-cases/handle-incoming-message.use-case.ts:37](<../../../../../apps/api/src/modules/whatsapp-channel/application/use-cases/handle-incoming-message.use-case.ts#L37>) |
| RouteToSessionUseCase | 178 | 2 | [apps/api/src/modules/whatsapp-channel/application/use-cases/route-to-session.use-case.ts:39](<../../../../../apps/api/src/modules/whatsapp-channel/application/use-cases/route-to-session.use-case.ts#L39>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-026](<ADR-api-whatsapp-channel.md#api-026>) (P1): Webhook confirma recebimento antes de persistir processamento.
- [API-024](<ADR-api-notifications.md#api-024>) (P1): Adaptadores retornam sucesso sem entrega confirmada.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Assinatura obrigatória, inbox, dedup distribuído, mídia limitada, retry, rotação e descarte de opt-out.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| GET /merchants/:merchantId/whatsapp/connection | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts:36](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts#L36>) |
| POST /merchants/:merchantId/whatsapp/meta/connect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts:63](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts#L63>) |
| POST /merchants/:merchantId/whatsapp/twilio/connect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts:91](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts#L91>) |
| POST /merchants/:merchantId/whatsapp/twilio/verify | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts:112](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts#L112>) |
| POST /merchants/:merchantId/whatsapp/disconnect | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts:128](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts#L128>) |
| POST /merchants/:merchantId/whatsapp/toggle | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts:143](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts#L143>) |
| POST /merchants/:merchantId/whatsapp/test | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts:164](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-config.controller.ts#L164>) |
| POST /webhooks/whatsapp/bubblewhats/messages | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts:73](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts#L73>) |
| POST /webhooks/whatsapp/bubblewhats/status | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts:130](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts#L130>) |
| POST /webhooks/whatsapp/twilio | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts:159](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts#L159>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-026"></a>

## API-026 — Webhook confirma recebimento antes de persistir processamento

| Campo | Registro |
| --- | --- |
| ID | API-026 |
| SEVERITY | P1 |
| MODULE | whatsapp-channel |
| FILE(S) | [apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts:90](<../../../../../apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts#L90>) |
| ISSUE | Webhook confirma recebimento antes de persistir processamento |
| EVIDENCE | BubbleWhats só exige segredo se config.webhookSecret existir e dispara void handleMessage.execute antes de retornar 200; status segue o mesmo padrão. |
| VERIFICATION | CONFIRMED_STATIC; configuração ativa sem segredo INFRA VALIDATION REQUIRED |
| PRODUCTION IMPACT | Configuração ativa sem segredo aceita mensagens forjadas; crash após 200 perde processamento e impede retry do provedor. |
| ROOT CAUSE | Autenticação opcional de webhook e ausência de inbox durável antes do acknowledgment. |
| RECOMMENDED FIX | Exigir segredo para canal habilitado, persistir evento com ID único em inbox antes do 2xx, processar com retries/dead-letter e rate limit. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Sem segredo/assinatura incorreta rejeitar; crash após 200 não perde evento; replay e duas réplicas processam uma única mensagem lógica. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
