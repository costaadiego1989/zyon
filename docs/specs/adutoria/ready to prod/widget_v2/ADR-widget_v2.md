# ADR — Widget v2: prontidão e consumo da API

Data: 2026-09-05. Status: auditoria registrada; correções propostas. Veredito: **FAIL / NO-GO**.

[Índice geral](<../README.md>) · [API primeiro](<../api/README.md>) · [Validação](<../VALIDACAO.md>)

## Escopo e controles existentes

Jornada React/Zustand de sessão embed, chat, carrinho, frete, PIX/cartão/cripto, gatilhos, suporte e tracking. O widget antigo removido não foi tratado como consumidor atual.

Cliente envia Bearer embed; pagamento não envia amount pelo método createPaymentIntent; mensagens de tema validam origem/source; token é removido da URL e guardado em sessionStorage.

Este relatório verifica integração e comportamento implementado, não é uma aprovação visual/acessibilidade do produto em navegador. Layout responsivo, leitores de tela e testes em dispositivos permanecem UNVERIFIED.

## ADRs por módulo do front

| Módulo | Call sites no agrupamento | Achados relacionados |
| --- | --- | --- |
| [bootstrap](<modulos/ADR-widget_v2-bootstrap.md>) | 11 | [W2-001](<ADR-widget_v2.md#w2-001>), [API-044](<../api/ADR-api-embed.md#api-044>) |
| [carrinho](<modulos/ADR-widget_v2-carrinho.md>) | 12 | [W2-007](<ADR-widget_v2.md#w2-007>), [API-043](<../api/ADR-api-checkout.md#api-043>) |
| [chat](<modulos/ADR-widget_v2-chat.md>) | 1 | [W2-004](<ADR-widget_v2.md#w2-004>), [W2-005](<ADR-widget_v2.md#w2-005>), [W2-009](<ADR-widget_v2.md#w2-009>) |
| [frete](<modulos/ADR-widget_v2-frete.md>) | 11 | [W2-004](<ADR-widget_v2.md#w2-004>), [API-023](<../api/ADR-api-shipping.md#api-023>) |
| [pagamentos](<modulos/ADR-widget_v2-pagamentos.md>) | 13 | [W2-002](<ADR-widget_v2.md#w2-002>), [W2-003](<ADR-widget_v2.md#w2-003>), [W2-005](<ADR-widget_v2.md#w2-005>), [W2-006](<ADR-widget_v2.md#w2-006>), [API-014](<../api/ADR-api-payment.md#api-014>) |
| [suporte](<modulos/ADR-widget_v2-suporte.md>) | 1 | [API-041](<../api/ADR-api-support.md#api-041>), [W2-009](<ADR-widget_v2.md#w2-009>) |
| [gatilhos](<modulos/ADR-widget_v2-gatilhos.md>) | 0 | [W2-010](<ADR-widget_v2.md#w2-010>), [API-021](<../api/ADR-api-coupons.md#api-021>) |
| [telemetria](<modulos/ADR-widget_v2-telemetria.md>) | 1 | [W2-008](<ADR-widget_v2.md#w2-008>), [API-034](<../api/ADR-api-revenue-lift.md#api-034>) |

Agrupamentos do storefront/widget podem compartilhar o mesmo client, portanto contagens por módulo não devem ser somadas. Inventário único do app: 15 chamadas extraídas.

## Decisão

Browser deve completar PIX e cartão/3DS com resposta real, manter sessão/carrinho autoritativos, distinguir estados financeiros e tratar falha sem inventar dados.

O contrato deve definir URL/método, principal, tenant/session, DTO, envelope, unidades, estados e idempotência. Manter fixtures derivadas de respostas reais e smoke sobre a composição production, incluindo ENABLE_LEGACY_ROUTES desligado.

<a id="w2-001"></a>

## W2-001 — Início não hidrata carrinho e identidade usados pelo pagamento

| Campo | Registro |
| --- | --- |
| ID | W2-001 |
| SEVERITY | P1 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/api/checkout-session.ts:184](<../../../../../apps/widget_v2/src/api/checkout-session.ts#L184>)<br>[apps/widget_v2/src/store/checkout-store.ts:146](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L146>)<br>[apps/api/src/modules/checkout/application/use-cases/start-checkout.use-case.ts:57](<../../../../../apps/api/src/modules/checkout/application/use-cases/start-checkout.use-case.ts#L57>) |
| ISSUE | Início não hidrata carrinho e identidade usados pelo pagamento |
| EVIDENCE | Widget envia cart:{items:[]} sem currency/total e usa customer_hints/global_user_id. StartCheckout usa input.customer e input.cart e não resolve cart_ref nesse fluxo. Depois widget lê storefront cart para exibição, sem sincronizar a sessão embed de pagamento. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Carrinho exibido pode ter itens enquanto sessão cobradora está vazia/incompleta; buyer informado no redirect não fica autenticado por esse parâmetro. |
| ROOT CAUSE | Confusão entre carrinho storefront, sessão checkout e hints de identidade. |
| RECOMMENDED FIX | API deve criar/retomar sessão por carrinho autoritativo e buyer token verificado; widget deve renderizar o snapshot dessa mesma sessão e preservar session_id no reload. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Redirect de carrinho real cria sessão com mesmos SKUs/valores; reload retoma a mesma compra; URL globalUserId não permite assumir identidade. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="w2-002"></a>

## W2-002 — Resposta de intenção é lida com nomes que a API não retorna

| Campo | Registro |
| --- | --- |
| ID | W2-002 |
| SEVERITY | P1 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/api/checkout-session.ts:134](<../../../../../apps/widget_v2/src/api/checkout-session.ts#L134>)<br>[apps/widget_v2/src/api/checkout-session.ts:298](<../../../../../apps/widget_v2/src/api/checkout-session.ts#L298>)<br>[apps/api/src/modules/payment/domain/payment-intent.entity.ts:32](<../../../../../apps/api/src/modules/payment/domain/payment-intent.entity.ts#L32>)<br>[apps/api/src/modules/payment/application/create-payment-intent.use-case.ts:344](<../../../../../apps/api/src/modules/payment/application/create-payment-intent.use-case.ts#L344>) |
| ISSUE | Resposta de intenção é lida com nomes que a API não retorna |
| EVIDENCE | API retorna id/amountCents/buyerFacing.qrCodeCopyPaste/clientSecret; widget faz cast direto para intent_id/amount_cents/pix_code/stripe_client_secret. Não há transformação no controller. R03 confirmou campos esperados undefined. |
| VERIFICATION | REPRODUCED_LOCAL R03 |
| PRODUCTION IMPACT | PIX sem código e requests de status/confirm com ID indefinido; cartão sem clientSecret. |
| ROOT CAUSE | Interfaces locais declaradas sem validação/adaptação do payload real. |
| RECOMMENDED FIX | Publicar DTO estável e gerar/validar client; mapear explicitamente ID, amount, QR e chaves públicas do provedor. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Resposta real de create para pix/card/crypto deve passar schema do client e renderizar instruções de pagamento utilizáveis. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="w2-003"></a>

## W2-003 — Polling omite session_id e ignora approved

| Campo | Registro |
| --- | --- |
| ID | W2-003 |
| SEVERITY | P1 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/api/checkout-session.ts:323](<../../../../../apps/widget_v2/src/api/checkout-session.ts#L323>)<br>[apps/widget_v2/src/store/checkout-store.ts:548](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L548>)<br>[apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:298](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L298>)<br>[apps/api/src/modules/payment/application/get-payment-intent-status.use-case.ts:53](<../../../../../apps/api/src/modules/payment/application/get-payment-intent-status.use-case.ts#L53>) |
| ISSUE | Polling omite session_id e ignora approved |
| EVIDENCE | Status endpoint exige query session_id; client não a envia (R04). Mesmo com request corrigido, store só conclui em paid/confirmed e API retorna approved. failed/cancelled/refunded também não encerram corretamente o fluxo. |
| VERIFICATION | REPRODUCED_LOCAL R04 + CONFIRMED_STATIC |
| PRODUCTION IMPACT | Pagamento confirmado permanece pendente até erro por timeout; comprador pode tentar pagar novamente. |
| ROOT CAUSE | Máquina de estados da UI não deriva do contrato financeiro. |
| RECOMMENDED FIX | Enviar ID de sessão, mapear todos os estados e diferenciar pagamento aprovado de pedido concluído; um polling ativo por intent, abort/cleanup e retomada após reload. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | PIX approved conclui após confirmação de pedido; failed/cancelled param polling; unmount/retry não cria timers paralelos. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="w2-004"></a>

## W2-004 — Frete usa envelope/campos divergentes e fallback com preços inventados

| Campo | Registro |
| --- | --- |
| ID | W2-004 |
| SEVERITY | P1 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/api/checkout-session.ts:266](<../../../../../apps/widget_v2/src/api/checkout-session.ts#L266>)<br>[apps/widget_v2/src/store/checkout-store.ts:290](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L290>)<br>[apps/widget_v2/src/components/ChatPanel.tsx:42](<../../../../../apps/widget_v2/src/components/ChatPanel.tsx#L42>)<br>[apps/api/src/modules/shipping/presentation/http/embed-shipping.controller.ts:41](<../../../../../apps/api/src/modules/shipping/presentation/http/embed-shipping.controller.ts#L41>)<br>[apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:317](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L317>) |
| ISSUE | Frete usa envelope/campos divergentes e fallback com preços inventados |
| EVIDENCE | Quote retorna results com carrier_key/price/eta_days; widget lê options/customerPrice/carrierKey (R05 retornou []). Select envia shipping_key, mas handlers duplicados esperam carrier_key ou option_index. UI envia texto Entrega em vez de chamar select e inventa PAC/SEDEX com valores fixos quando API falha. |
| VERIFICATION | REPRODUCED_LOCAL R05 + CONFIRMED_STATIC |
| PRODUCTION IMPACT | Frete não é persistido e pagamento pode falhar shipping_method_required_before_payment; preço/prazo exibidos não são cotação aprovada. |
| ROOT CAUSE | Dois contratos backend para o mesmo path e UI com simulação de resposta em runtime. |
| RECOMMENDED FIX | Unificar endpoint e DTO de quote/select, usar chave da cotação vigente e remover opções fabricadas; mostrar erro retryable sem avançar pagamento. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Cotação real deve renderizar e selecionar preço exato na sessão; provider indisponível não oferece frete fictício nem libera pagamento. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="w2-005"></a>

## W2-005 — Cartão não tem renderer ativo e confirmação usa body incorreto

| Campo | Registro |
| --- | --- |
| ID | W2-005 |
| SEVERITY | P1 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/store/checkout-store.ts:515](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L515>)<br>[apps/widget_v2/src/components/ChatPanel.tsx:260](<../../../../../apps/widget_v2/src/components/ChatPanel.tsx#L260>)<br>[apps/widget_v2/src/layouts/CheckoutLayout.tsx:229](<../../../../../apps/widget_v2/src/layouts/CheckoutLayout.tsx#L229>)<br>[apps/widget_v2/src/components/StripeCardPayment.tsx:47](<../../../../../apps/widget_v2/src/components/StripeCardPayment.tsx#L47>)<br>[apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:279](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L279>) |
| ISSUE | Cartão não tem renderer ativo e confirmação usa body incorreto |
| EVIDENCE | Store adiciona bloco stripe_card, mas BlockRenderer não o implementa. PaymentSelector/StripeCardPayment não são renderizados pelo layout ativo. Se montado, confirm envia payment_intent_id enquanto API exige session_id; chave pública tem fallback pk_test_placeholder. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Comprador escolhe cartão e não recebe formulário útil; confirmação corrigida parcialmente ainda falha 400. |
| ROOT CAUSE | Componente legado ficou desconectado da jornada de chat e contrato não foi atualizado. |
| RECOMMENDED FIX | Integrar renderer de cartão ao fluxo ativo, usar buyerFacing/clientSecret e publishable key válida, confirmar com session_id e recuperar resultado do backend. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Teste em navegador percorre cartão/3DS até pedido; webhook atrasado e falha de rede não causam cobrança duplicada nem sucesso falso. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="w2-006"></a>

## W2-006 — Cripto é oferecida sem fluxo de pagamento e confirmação

| Campo | Registro |
| --- | --- |
| ID | W2-006 |
| SEVERITY | P1 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/store/checkout-store.ts:325](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L325>)<br>[apps/widget_v2/src/store/checkout-store.ts:515](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L515>)<br>[apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:253](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L253>) |
| ISSUE | Cripto é oferecida sem fluxo de pagamento e confirmação |
| EVIDENCE | Quando habilitada, UI oferece crypto, mas pay trata todo método diferente de pix como stripe_card. Não há client que use destinationAddress/amountAtomic nem confirmação tx_hash/wallet_address. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Método oferecido não pode ser concluído no widget atual. |
| ROOT CAUSE | Flag do backend incorporada ao seletor sem implementação da capacidade no consumidor. |
| RECOMMENDED FIX | Implementar quote/carteira/transação/expiração/confirmação ou ocultar capacidade até existir jornada validada. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Crypto habilitada só aparece quando client suporta a rede/token e conclui confirmação idempotente; expiração e rede incorreta são bloqueadas. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="w2-007"></a>

## W2-007 — Alteração de carrinho não invalida sessão/intent do checkout

| Campo | Registro |
| --- | --- |
| ID | W2-007 |
| SEVERITY | P1 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/store/checkout-store.ts:437](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L437>)<br>[apps/widget_v2/src/api/checkout-session.ts:241](<../../../../../apps/widget_v2/src/api/checkout-session.ts#L241>)<br>[apps/widget_v2/src/api/checkout-session.ts:305](<../../../../../apps/widget_v2/src/api/checkout-session.ts#L305>)<br>[apps/api/src/modules/checkout/application/use-cases/update-cart.use-case.ts:76](<../../../../../apps/api/src/modules/checkout/application/use-cases/update-cart.use-case.ts#L76>) |
| ISSUE | Alteração de carrinho não invalida sessão/intent do checkout |
| EVIDENCE | Widget altera carrinho storefront via PATCH, não chama embed/cart. Mantém shipping/paymentIntent e chave pay_<session>_<method> mesmo após mudança. A API embed/cart possui invalidação de frete, mas esse caminho não é usado. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Preço exibido, frete selecionado e valor da intenção podem divergir; nova tentativa pode recuperar intenção antiga. |
| ROOT CAUSE | Ciclo de revisão do carrinho não é parte da identidade da intenção. |
| RECOMMENDED FIX | Mutar a sessão autoritativa, invalidar cotação/intent, impedir pagar durante sincronização e gerar chave por revisão/ação com retry estável. |
| COMPLEXITY | L (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Alto |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Mudar quantidade após gerar PIX exige novo total/intent válido e impede usar intenção antiga para concluir pedido alterado. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.

<a id="w2-008"></a>

## W2-008 — Tracking envia campos diferentes do contrato e não captura rejeição assíncrona

| Campo | Registro |
| --- | --- |
| ID | W2-008 |
| SEVERITY | P2 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/lib/tracking.ts:30](<../../../../../apps/widget_v2/src/lib/tracking.ts#L30>)<br>[packages/shared-types/src/index.ts:501](<../../../../../packages/shared-types/src/index.ts#L501>)<br>[apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts:105](<../../../../../apps/api/src/modules/embed/presentation/http/embed-checkout.controller.ts#L105>) |
| ISSUE | Tracking envia campos diferentes do contrato e não captura rejeição assíncrona |
| EVIDENCE | Client envia event_name/event_data; TrackEventRequest espera event/metadata. void fetch dentro de try/catch sem await não captura rejeição da Promise e não verifica HTTP status. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Funil, abandono e gatilhos deixam de refletir ações reais sem erro visível; análise de conversão perde confiabilidade. |
| ROOT CAUSE | Telemetria tratada como payload livre e best-effort sem observação de falha. |
| RECOMMENDED FIX | Alinhar enum/schema e propagação de metadata, registrar rejeições e usar entrega compatível com unload quando necessária. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Cada evento da UI aceito pelo backend persiste com sessão e metadata; 400/rede indisponível são mensuráveis sem Promise rejeitada não tratada. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.

<a id="w2-009"></a>

## W2-009 — Suporte responde políticas fixas em vez das configurações da loja

| Campo | Registro |
| --- | --- |
| ID | W2-009 |
| SEVERITY | P2 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/components/SupportPanel.tsx:120](<../../../../../apps/widget_v2/src/components/SupportPanel.tsx#L120>)<br>[apps/api/src/modules/support/presentation/http/support.controller.ts:120](<../../../../../apps/api/src/modules/support/presentation/http/support.controller.ts#L120>) |
| ISSUE | Suporte responde políticas fixas em vez das configurações da loja |
| EVIDENCE | Cliques FAQ retornam localmente prazo 2–7 dias, trocas 30 dias e meios de pagamento fixos; não buscam /support/faq. Socket também não envia credenciais, dependendo do gateway inseguro API-041. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Promessas ao comprador podem contrariar configurações reais. Endurecer o backend sem atualizar socket rompe atendimento. |
| ROOT CAUSE | Conteúdo demonstrativo e protocolo anônimo mantidos no fluxo ativo. |
| RECOMMENDED FIX | Consultar FAQ tenant-scoped e renderizar indisponibilidade quando ausente; autenticar socket e distinguir buyer/merchant. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | NO |
| CRITÉRIO DE ACEITE | Alterar FAQ no dashboard muda conteúdo exibido; falha na API não inventa política; buyer recebe somente o seu ticket. |

Decisão: registrar correção priorizada e acompanhar o risco residual. Correção ainda não implementada nesta auditoria.

<a id="w2-010"></a>

## W2-010 — Desconto é anunciado sem autorização persistida

| Campo | Registro |
| --- | --- |
| ID | W2-010 |
| SEVERITY | P2 |
| MODULE | widget_v2 |
| FILE(S) | [apps/widget_v2/src/App.tsx:114](<../../../../../apps/widget_v2/src/App.tsx#L114>)<br>[apps/widget_v2/src/store/checkout-store.ts:586](<../../../../../apps/widget_v2/src/store/checkout-store.ts#L586>)<br>[apps/widget_v2/src/components/DiscountBanner.tsx:1](<../../../../../apps/widget_v2/src/components/DiscountBanner.tsx#L1>) |
| ISSUE | Desconto é anunciado sem autorização persistida |
| EVIDENCE | Gatilhos idle/exit chamam setActiveDiscount(stage,5), que muda estado local; não solicita oferta autorizada nem aplica offer_id nesse caminho. |
| VERIFICATION | CONFIRMED_STATIC |
| PRODUCTION IMPACT | Banner pode prometer 5% que não chega ao total do pagamento e pode ultrapassar regra da loja. |
| ROOT CAUSE | Gatilho de experiência confundido com concessão monetária. |
| RECOMMENDED FIX | Solicitar oferta ao motor do servidor, exibir somente percentual/id/expiração autorizados e refletir aplicação na sessão. |
| COMPLEXITY | M (S: pequena; M: média; L: ampla, sem estimativa de prazo) |
| RISK OF CHANGE | Médio |
| BLOCKS PROD? | YES |
| CRITÉRIO DE ACEITE | Loja com desconto máximo zero nunca exibe oferta de 5%; oferta exibida deve ser reconciliada no pagamento. |

Decisão: bloquear a liberação da capacidade afetada até cumprir o critério de aceite. Correção ainda não implementada nesta auditoria.


## Dependências para produção

As correções de segurança e dinheiro da API precedem o aceite dos fronts. Não há prova de E2E browser, providers reais ou deployment; os resultados de tipo/teste e reproduções estão em [Validação](<../VALIDACAO.md>).
