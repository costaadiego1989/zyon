# ADR — API / shipping

Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Cotar/selecionar frete e comprar etiqueta.

Inventário: 23 arquivos de implementação, 17 arquivos reconhecidos como testes, 1658 linhas de implementação. 9 declarações HTTP; 9 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, checkout, commerce, embed, fulfillment, integrations, merchant**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `merchant`, `outboxMessage`, `shippingQuote`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Há dois handlers embed/shipping/select com DTOs diferentes; compra de etiqueta precede validação de order. Artefato local shipping-engine ausente impediu uma suíte.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 4/10 | 6/10 | 3/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Política de subsídio deriva de regras do merchant; cache de quote inclui regra e valida sessão. Quote aplica merge de frete grátis sem duplicar carrier.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| MelhorEnvioCarrierAdapter | 196 | 0 | [apps/api/src/modules/shipping/infrastructure/adapters/melhor-envio.carrier.ts:17](<../../../../../apps/api/src/modules/shipping/infrastructure/adapters/melhor-envio.carrier.ts#L17>) |
| MelhorEnvioOAuthController | 139 | 1 | [apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts:13](<../../../../../apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts#L13>) |
| QuoteShippingUseCase | 126 | 3 | [apps/api/src/modules/shipping/application/use-cases/quote-shipping.use-case.ts:30](<../../../../../apps/api/src/modules/shipping/application/use-cases/quote-shipping.use-case.ts#L30>) |

Não há candidato acima de 300 linhas/10 dependências entre as classes listadas. Isso não certifica SRP/LSP/ISP; contratos e comportamentos substituíveis precisam dos testes descritos.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-023](<ADR-api-shipping.md#api-023>) (P1): Compra de etiqueta precede validação do pedido.
- [W2-004](<../widget_v2/ADR-widget_v2.md#w2-004>) (P1): Frete usa envelope/campos divergentes e fallback com preços inventados.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Contrato único de quote/select, preço em unidade fixa, origem/tenant por transportadora, invalidação de quote e recuperação de etiqueta.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /embed/shipping/quote | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/shipping/presentation/http/embed-shipping.controller.ts:41](<../../../../../apps/api/src/modules/shipping/presentation/http/embed-shipping.controller.ts#L41>) |
| POST /embed/shipping/select | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/shipping/presentation/http/embed-shipping.controller.ts:65](<../../../../../apps/api/src/modules/shipping/presentation/http/embed-shipping.controller.ts#L65>) |
| GET /shipping/melhor-envio/authorize | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts:18](<../../../../../apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts#L18>) |
| GET /shipping/melhor-envio/callback | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts:60](<../../../../../apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts#L60>) |
| GET /shipping/melhor-envio/status | Alcançável estaticamente | UseGuards(AuthGuard) | [apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts:118](<../../../../../apps/api/src/modules/shipping/presentation/http/melhor-envio-oauth.controller.ts#L118>) |
| POST /shipping/labels | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard); Idempotent() | [apps/api/src/modules/shipping/presentation/http/shipping-label.controller.ts:27](<../../../../../apps/api/src/modules/shipping/presentation/http/shipping-label.controller.ts#L27>) |
| GET /shipping/tracking/:shipmentId | Alcançável estaticamente | UseGuards(TenantCredentialGuard,TenantAccessGuard) | [apps/api/src/modules/shipping/presentation/http/shipping-label.controller.ts:70](<../../../../../apps/api/src/modules/shipping/presentation/http/shipping-label.controller.ts#L70>) |
| POST /widget/shipping/quote | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/shipping/presentation/http/widget-shipping.controller.ts:23](<../../../../../apps/api/src/modules/shipping/presentation/http/widget-shipping.controller.ts#L23>) |
| POST /widget/shipping/select | Registrada, bloqueada em prod salvo flag legacy | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/shipping/presentation/http/widget-shipping.controller.ts:32](<../../../../../apps/api/src/modules/shipping/presentation/http/widget-shipping.controller.ts#L32>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-023"></a>

## API-023 — Compra de etiqueta precede validação do pedido

| Campo | Registro |
| --- | --- |
| ID | API-023 |
| SEVERITY | P1 |
| MODULE | shipping |
| FILE(S) | [apps/api/src/modules/shipping/application/use-cases/shipping-label.use-cases.ts:20](<../../../../../apps/api/src/modules/shipping/application/use-cases/shipping-label.use-cases.ts#L20>) |
| ISSUE | Compra de etiqueta precede validação do pedido |
| EVIDENCE | O use case valida strings e chama provider.purchaseLabel antes de obter/validar o pedido por ownership; updateTracking só ocorre depois. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Pode gastar em etiqueta para pedido inexistente ou deixar etiqueta comprada sem vínculo quando persistência falha. |
| ROOT CAUSE | Efeito externo precede pré-condições locais e não tem intenção durável recuperável. |
| RECOMMENDED FIX | Validar pedido/endereço/estado/tenant antes da compra; persistir intent idempotente e reconciliar etiqueta emitida após resposta perdida. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Pedido inexistente/alheio nunca chama provedor; timeout após compra deve recuperar a mesma etiqueta e rastreio. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
