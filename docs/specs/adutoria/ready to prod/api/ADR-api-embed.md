# ADR — API / embed

> Implementação posterior na branch `fix/ready-to-prod-audit`: consultar [correções, evidências e pendências](../CORRECOES.md). O conteúdo abaixo preserva o retrato da auditoria original; o gate de produção continua aberto.


Data: 2026-09-05. Status: decisão de auditoria registrada; correções propostas. Veredito: **FAIL**.

[Índice geral](<../README.md>) · [API primeiro](<README.md>) · [Evidências e limites](<../VALIDACAO.md>)

## Contexto e responsabilidade

Emitir credencial embed e adaptar APIs de checkout/pagamento para browser.

Inventário: 19 arquivos de implementação, 16 arquivos reconhecidos como testes, 2482 linhas de implementação. 21 declarações HTTP; 21 alcançáveis pela composição estática. Contagem de testes não é cobertura de branches nem execução comprovada.

## Boundary, dependências e ownership

Imports intermodulares observados: **auth, catalog, checkout, installations, integrations, intent-memory, merchant, payment**. A lista inclui referências de tipo e é evidência de acoplamento de código, não de todas as dependências em runtime.

Acessos Prisma reconhecidos pelo extrator: `protocolSession`. Nomes são modelos acessados, não prova de ownership; casts e SQL bruto podem exigir leitura adicional.

Emissão interna está exposta por proxy público com tenant arbitrário; start não impõe preço/identidade autoritativos. Dois handlers shipping/select coexistem com DTOs incompatíveis.

| Coesão | Controle do acoplamento | Boundary | Ownership dos dados | Prontidão |
| --- | --- | --- | --- | --- |
| 6/10 | 4/10 | 4/10 | 4/10 | 1/10 |

Notas são avaliação técnica qualitativa do código inspecionado, não métricas de carga nem garantia de segurança. Zero em knowledge-base significa ausência de evidência, não reprovação de código inexistente.

## Controles observados

Token tem scopes/origin/expiração; controllers derivam merchant do token e verificam sessão em várias operações. Instalação fornecida é resolvida e validada.

## God services, SOLID, KISS e DRY

| Classe inspecionável | Linhas da classe | Dependências no construtor | Fonte |
| --- | --- | --- | --- |
| EmbedCheckoutController | 274 | 11 | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:75](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L75>) |
| ProtocolAgentController | 221 | 3 | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:44](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L44>) |
| UpdateEmbedCustomerUseCase | 159 | 3 | [apps/api/src/modules/embed/application/update-embed-customer.use-case.ts:8](<../../../../../apps/api/src/modules/embed/application/update-embed-customer.use-case.ts#L8>) |

Há candidato a concentração de responsabilidades. Separar protocolo HTTP, política de negócio e coordenação de efeitos em etapas pequenas; tamanho é sinal de revisão, não defeito por si só.

DIP/boundary: revisar os imports acima e os acessos a dados com a matriz global. DRY: compartilhar contratos e política de unidade/estado, preservando regra no módulo dono. KISS/object calisthenics são critérios de legibilidade; não justificam fragmentar métodos mecanicamente ou criar microserviços.

## Transações, concorrência, segurança e resiliência

- [API-044](<ADR-api-embed.md#api-044>) (P1): Emissão via storefront transforma parâmetros públicos em credencial de tenant.
- [API-043](<ADR-api-checkout.md#api-043>) (P0): Preço e frete iniciais podem vir do cliente sem revalidação de catálogo.
- [W2-002](<../widget_v2/ADR-widget_v2.md#w2-002>) (P1): Resposta de intenção é lida com nomes que a API não retorna.
- [W2-003](<../widget_v2/ADR-widget_v2.md#w2-003>) (P1): Polling omite session_id e ignora approved.
- [W2-004](<../widget_v2/ADR-widget_v2.md#w2-004>) (P1): Frete usa envelope/campos divergentes e fallback com preços inventados.

Performance/índices: consultar [matriz de schema e operação](<../BANCO-E-OPERACAO.md>). Planos reais, pool, memória, CPU, cache distribuído e volume de 10.000 usuários: **REQUIRES LOAD VALIDATION**.

Observabilidade: Logger/CorrelationId e infraestrutura comum existem, mas dashboards/alertas e correlação ponta a ponta deste módulo são **INFRA VALIDATION REQUIRED**. Segurança externa, segredos configurados e recuperação de backup não foram inspecionados no ambiente produtivo.

## Decisão e consequências

1. Preservar o monólito modular e atribuir ao módulo somente sua capacidade descrita.
2. Corrigir os achados vinculados antes de habilitar/liberar os fluxos afetados.
3. Expor comunicação por portas/facades e eventos versionados; acesso direto a outro agregado deve ser substituído gradualmente.
4. Validar em banco/servidor real os cenários do gate; nenhum PASS de produção é inferido da existência de testes.

Gate específico: **Fechar origem/instalação/carrinho, validar todos os scopes e publicar um DTO por operação consumido pelo widget.**

Consequência: o módulo poderá ser reavaliado isoladamente após a correção, mas a liberação depende dos gates compartilhados de autenticação, tenant, persistência, build e mensageria.

## Superfície HTTP observada

| Método/path normalizado | Composição | Metadata extraída | Evidência |
| --- | --- | --- | --- |
| POST /embed/start | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("checkout:start") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:92](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L92>) |
| POST /embed/track | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("checkout:track") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:105](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L105>) |
| POST /embed/chat | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("checkout:chat") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:120](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L120>) |
| POST /embed/offers/apply | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("offers:apply") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:135](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L135>) |
| POST /embed/cart | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("checkout:track") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:150](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L150>) |
| POST /embed/customer/update | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("checkout:track") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:165](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L165>) |
| POST /embed/payment/intents | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("payment:intents:create") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:210](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L210>) |
| POST /embed/payment/intents/:intentId/crypto/confirm | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("payment:intents:confirm") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:253](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L253>) |
| POST /embed/payment/intents/:intentId/stripe/confirm | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("payment:intents:confirm") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:279](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L279>) |
| GET /embed/payment/intents/:intentId/status | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("payment:intents:read") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:298](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L298>) |
| POST /embed/shipping/select | Alcançável estaticamente | UseGuards(EmbedAuthGuard); RequireEmbedScope("checkout:track") | [apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:317](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L317>) |
| POST /embed/checkout/consent | Alcançável estaticamente | UseGuards(EmbedAuthGuard) | [apps/api/src/modules/embed/presentation/http/embed-consent.controller.ts:36](<../../../../../apps/api/src/modules/embed/presentation/http/embed-consent.controller.ts#L36>) |
| POST /embed-sessions | Alcançável estaticamente | UseGuards(EmbedSessionIssuerGuard); Idempotent() | [apps/api/src/modules/embed/presentation/http/embed-sessions.controller.ts:80](<../../../../../apps/api/src/modules/embed/presentation/http/embed-sessions.controller.ts#L80>) |
| POST /embed/sessions | Alcançável estaticamente | UseGuards(EmbedSessionIssuerGuard); Idempotent() | [apps/api/src/modules/embed/presentation/http/embed-sessions.controller.ts:80](<../../../../../apps/api/src/modules/embed/presentation/http/embed-sessions.controller.ts#L80>) |
| POST /protocol/start | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:54](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L54>) |
| POST /protocol/discover | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:89](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L89>) |
| POST /protocol/negotiate | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:125](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L125>) |
| POST /protocol/quote | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:147](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L147>) |
| POST /protocol/checkout | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:169](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L169>) |
| POST /protocol/pay | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:191](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L191>) |
| GET /protocol/track | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:213](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L213>) |
| GET /protocol/state | Alcançável estaticamente | Sem metadata de guard extraída; verificar guards globais/método | [apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts:230](<../../../../../apps/api/src/modules/embed/presentation/http/protocol-agent.controller.ts#L230>) |

/v1 é removido pelo middleware de versionamento antes do roteamento; o prefixo não ativa um controller ausente nem contorna NonProductionRoute. Paths listados são declarações estáticas; boot Nest e colisões precisam de smoke.

<a id="api-044"></a>

## API-044 — Emissão via storefront transforma parâmetros públicos em credencial de tenant

| Campo | Registro |
| --- | --- |
| ID | API-044 |
| SEVERITY | P1 |
| MODULE | embed |
| FILE(S) | [apps/storefront/src/app/api/checkout-token/route.ts:3](<../../../../../apps/storefront/src/app/api/checkout-token/route.ts#L3>)<br>[apps/api/src/modules/embed/presentation/http/embed-session-issuer.guard.ts:53](<../../../../../apps/api/src/modules/embed/presentation/http/embed-session-issuer.guard.ts#L53>)<br>[apps/api/src/modules/embed/presentation/http/embed-sessions.controller.ts:122](<../../../../../apps/api/src/modules/embed/presentation/http/embed-sessions.controller.ts#L122>) |
| ISSUE | Emissão via storefront transforma parâmetros públicos em credencial de tenant |
| EVIDENCE | Rota Next pública aceita merchant_id, cart_ref e allowed_origin arbitrários, injeta o INTERNAL_SERVICE_TOKEN e X-Merchant-Id; a API aceita esse merchant e só valida instalação quando installation_id é fornecido. A emissão sem instalação não comprova domínio/carrinho do solicitante. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Qualquer caller da rota pode solicitar token com escopos de checkout/pagamento para tenant/origem escolhidos, ampliando o impacto dos defeitos de ownership e preço. |
| ROOT CAUSE | Proxy com privilégio de serviço não valida o contexto público antes de exercer sua autoridade. |
| RECOMMENDED FIX | Resolver tenant pelo host/slug registrado, vincular origem à instalação autorizada e carrinho à sessão do buyer; restringir escopos/TTL e aplicar rate limit na emissão. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Host de A não emite token de B, origem arbitrária é rejeitada e carrinho alheio não pode ser vinculado. Emissão anônima legítima permanece limitada ao contexto autorizado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Reavaliação

Executar o gate específico, os critérios dos achados e testes relevantes da [sequência de correções](<../PLANO-DE-CORRECAO.md>). Guardar commit, configuração não secreta, comandos, resultado e evidência de banco/provedor. A auditoria atual não realizou essas correções.
