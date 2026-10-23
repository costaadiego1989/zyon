# Cross-sell: revisão de compatibilidade e aceite em um clique

Estado: proposta somente leitura em `AACP-integracao`, base `4908a053` mais
transferência seletiva local. Não implementa grant, endpoint ou mudança de UI.
Não é prova de sandbox ou produção. Nenhuma chamada LLM/provider foi realizada.

## Restrições verificadas

- Preservar componente, layout, temas e CTA aprovados. Nenhum segundo passo,
  controller visual, modal adicional ou confirmação extra.
- O clique existente pode confirmar uma cotação que JÁ estava ligada ao card
  exibido. Não pode confirmar silenciosamente outra condição calculada depois.
- Template, texto de chat, nome/SKU, percentual publicitário e saída LLM não
  autorizam benefício. `ui_action` público continua exclusivamente read-only.
- Preço e benefício exibidos vêm de autoridade comercial do servidor, não de
  multiplicação no componente. Não omitir um benefício prometido cobrando base.
- Não remover os guards enquanto o caminho completo não tiver paridade.
- CLAUDE.md e Impeccable/product/harden/PRODUCT.md lidos. Contexto do skill já
  executado nesta conversa; não repetido. Nenhum AGENTS.md encontrado na raiz
  ou na árvore `apps`/`.specs` pesquisada.

## Handoffs reais

| Superfície | Entrada/saída atual | Consequência atual |
| --- | --- | --- |
| Chat inline/banner storefront | `apps/storefront/src/components/blocks/CrossSellBlock.tsx:266`: CTA envia `Adicionar ... [variantId:id][crossSellPromoId:promo]`; `:274` agenda outro chat de cupom em 400 ms | Passa pelo fluxo de mensagem/ferramentas; não há concessão única de item + cupom |
| Interstitial storefront | `apps/storefront/src/components/ConversationShell.tsx:1132`: fecha painel/oferta, envia as mesmas tags; `:1141` agenda cupom | O card é dispensado antes de existir confirmação comercial |
| Detalhe de produto storefront | `apps/storefront/src/components/ConversationShell.tsx:1222`: callback do painel rico dispensa oferta, envia tags; `:1226` agenda cupom | Mesmo transporte legado; produto de contexto visual não prova trigger persistido no carrinho |
| Widget ativo, quatro displayModes | `apps/widget_v2/src/components/chat/ChatBlocks.tsx:627`: com suggestionId/SKU chama store; sem ambos usa chat de recomendação sem benefício | Aceite explícito passa pelo endpoint; nunca usar esse fallback para uma oferta comercial tipada |
| Transporte widget | `apps/widget_v2/src/api/checkout-session.ts:566`: POST `/embed/cross-sell/accept`, body `{session_id,suggestion_id,accepted_skus:[sku]}` | Resposta atual inclui `experience`; cliente atualiza carrinho só em sucesso e mostra erro tipado sem fallback após falha |
| Transporte storefront preparado | `apps/storefront/src/lib/api/api-client.ts:229`: `crossSellApi.quote/accept` declarados, escopo capturado e parse estrito | Sem callsite UI. Nenhum endpoint quote/accept correspondente foi encontrado no controller storefront atual |

O widget órfão `apps/widget` não é a superfície ativa nem alternativa de aceite.

## Autoridade/guard que já existe

- `storefront/infrastructure/tool-handlers/cart.handlers.ts:310` recusa
  `crossSellPromoId` antes do `cartRepo.addItem` (`:314`). Não é regressão causada
  por template: é uma restrição comercial explícita sem provenance anterior.
- `cross-sell/application/use-cases/accept-cross-sell-suggestion.use-case.ts:48`
  permite apenas `computed_discount === 0`. Benefícios/valores desconhecidos
  recebem 422 `cross_sell_quote_review_required` antes de writes.
- `cross-sell/presentation/http/widget-cross-sell.controller.ts:31` mantém
  EmbedAuthGuard e ownership da sessão; merchant vem da claim, não do body.
- `cross-sell/application/use-cases/accept-cross-sell-from-widget.use-case.ts:33`
  faz preflight antes de getRules/resolução. O restante legado salva suggestion,
  outbox, sessão e chat em chamadas distintas, não em uma transação conjunta.
  Não serve como implementação de grant atômico só removendo o preflight.
- `cross-sell/infrastructure/repositories/prisma-cross-sell-suggestion.repository.ts:12`
  usa upsert genérico. Isso não é CAS `pending -> accepted` nem exclusão conjunta
  com carrinho/pagamento. Não reutilizar como prova de consumo único.

### Adaptador real reutilizável, com limites

`storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.ts`:

- `:26` quote sob cart lock; `:28` recusa redemption de cupom ativa.
- `:29` exige carrinho existente/válido; `:34` recusa target já presente.
- `:35` resolve catálogo tenant-scoped; `:39` revalida admissão/estoque.
- `:40` simula post-add, preservando base/origem; `:44` usa autoridade comum.
- `:90` accept: reconsulta sob a mesma TX; compara cartBasis e DTO completos
  (`:95-97`), adiciona intent com preço base/maximum (`:101`) e compara o
  resultado comercial final (`:105`). ACK somente após commit (`:108`).
- Não faz retry. Repetição após commit não oferece receipt idempotente: target
  já existente é recusado. Não apresentar como exactly-once ou recovery pronto.
- Está limitado ao subconjunto físico/local suportado pelo schema e leitores.
  Não transforma carrinho checkout em storefront nem resolve lifecycle cupom.
- `cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.ts:17`
  exige cupom nulo/freeShipping false; não ampliar isso só para passar um fluxo.

## Lacuna antes de habilitar o mesmo clique

Cards atuais não carregam uma oferta financeira fechada ligada ao carrinho:

- `storefront/application/services/pre-cart-cross-sell-preview.ts:130` produz
  preço base e percentual da promoção, sem cartBasis/cap/margem post-add.
- `storefront/application/services/public-product-cross-sell-preview.ts:6`
  é leitura pública sem criação de carrinho/suggestion. Preservar esse contrato.
- `storefront/infrastructure/tool-handlers/cart-cross-sell.helper.ts:116`
  resolve pelo primeiro variant e mapa lower-case de SKU; não constitui resolução
  única/autoritativa do variant ofertado. `:124` repassa computed_discount.
- `cross-sell/application/services/checkout-cross-sell-recommender.ts:90`
  enriquece o card com preço base do catálogo. `suggestion_id` liga o registro,
  mas não o valor/basis exibidos a uma cotação comercial post-add.
- Prisma `CrossSellSuggestion` (`prisma/schema.prisma:1411`) contém rankedItems
  `String[]`, computedDiscount Decimal, status e datas. Não guarda original price,
  currency, cartBasis, promoção updatedAt ou cotação comercial. Esses dados não
  podem ser reconstruídos como se fossem a oferta que o comprador já viu.

Portanto um adapter interno que simplesmente chama quote+accept no clique é
insuficiente: calcula uma NOVA condição sem demonstrar igualdade à apresentada.

## Menor integração selecionada (proposta, não implementação)

1. Manter os mesmos cards e seus campos visuais. Antes de apresentar um benefício
   habilitado, obter cotação autoritativa para o carrinho/sessão autenticados;
   usar os valores retornados nos mesmos campos de preço/benefício do componente.
   Anexar metadata de cotação separada do texto, sem novo CTA/segundo passo.
   Leitura pública de produto continua read-only; sem contexto autenticado/basis
   suficiente, o preview não vira grant. Trigger visual não vira trigger persistido.
2. O callback do CTA atual recebe seleção + metadata válida e chama um único
   comando direto. Não enviar tag/LLM nem agendar cupom para esse aceite tipado.
   Recomendações zero-benefício continuam distinguíveis, sem inventar promoção.
3. No storefront, reutilizar `StorefrontCrossSellCartPort.accept(scope,{expectedQuote})`
   e o transporte já declarado, após controller fino com capability/origin/tenant
   equivalentes aos demais comandos de carrinho e escopo vinculado. Não importar
   a autorização embed para aceitar capability storefront nem ampliar readUiAction.
4. No widget, preservar `/embed/cross-sell/accept`, os três campos existentes e o
   shape `experience` esperado pelo store. Acrescentar metadata de precondição em
   extensão versionada para ofertas novas; payload antigo com benefício segue422.
   Um serviço de aplicação interno revalida suggestion/sessão/SKU/catálogo, calcula
   autoridade no contexto checkout e faz cart mutation + CAS da suggestion + outbox
   na MESMA TX com os fences de pagamento existentes. Não usar o adapter storefront
   diretamente sobre `CheckoutSession` nem chamar getRules provisionador no grant.
5. Após commit confirmado, aplicar a projeção autoritativa/refresh GET. Em 409/422,
   preservar carrinho/payment e oferta com erro fixo; sem dismiss antecipado, nova
   tentativa automática, full-price fallback ou aplicação parcial. Falha de rede é
   resultado desconhecido, não autorização para repetir POST.

### Contrato público byte-idêntico: limite concreto

É possível manter endpoint e forma visual. Manter o body antigo EXATAMENTE só é
seguro se o servidor retiver previamente a cotação emitida, vinculada ao existente
suggestion_id/session_id e resolvida sob lock. Esse armazenamento não existe hoje.
No storefront, promoId + variantId não identificam uma emissão individual.

A menor opção sem inventar armazenamento/HMAC é metadata aditiva `expectedQuote`
na mesma intenção de clique, com revalidação completa no servidor. Ela é
precondição, não autoridade. O DTO storefront existente pode ser reutilizado apenas
no contexto dele; checkout requer seu próprio basis (shipping/payment/currency).
Não declarar um DTO storefront aceito como quote checkout por conversão insegura.

## Campos mínimos por oferta nova

- Version, tenant, recurso autenticado/conversation/cart ou checkout session.
- Identidade inequívoca de emissão/suggestion e seleção: variantId + productId +
  SKU + promotionId + promotionUpdatedAt + quantidade; não derivar productId do SKU.
- BRL/base original em centavos, máximo efetivo exibido, cartBasis e orçamento
  comercial B/P/D/total; nenhum custo/margem/secret no payload público.
- Cupom explícito, quando suportado, faz parte da MESMA proposta/transação, nunca
  de timer ou extração textual. O subconjunto atual sem cupom não pode anunciá-lo.
- Binding ao conteúdo exibido é transportado fora do texto gerado. Saída LLM pode
  no máximo apontar candidatos; servidor valida/hidrata a oferta antes de mostrá-la.

## Primeiro RED e critérios de aceite

Teste integração mínimo a criar antes de runtime: oferta autorizada post-add de
target físico local, mesmo variant com product/SKU explícitos, cartBasis A e P/D
não nulos. Um clique em cada placement deve executar UM comando, zero chat/timer;
após commit, GET/reload/bootstrap checkout têm exatamente o mesmo preço e total.
Hoje esse teste é RED por ausência de metadata/callback/endpoint storefront e
guard comercial widget. Esta revisão não executou nem inventou esse resultado.

Expandir o RED com:

- mudança de qty/cupom/promoUpdatedAt/estoque/policy entre exibição e clique:
  409/422 sem writes; não reprecificar outra oferta silenciosamente;
- dois cliques concorrentes: no máximo um efeito commitado, suggestion consumida
  por CAS na mesma TX; segundo não incrementa qty nem emite outro evento;
- margem/custo ausente, cap excedido, SKU ambíguo/foreign, target existente,
  trigger apenas visual, food/service/options/marketplace não suportados: recusa;
- desconto produto vs cross-sell usa o maior, não soma; P não é reaplicado como D;
  cupom/regra adicional nunca ultrapassa teto; notice corresponde ao efeito real;
- rede perdida após POST: zero retry/fallback; payment/cart local não são inventados;
- embed/tenant/origin/session expirados e sessão trocada durante IO: nenhuma escrita
  na sessão nova, nenhum downgrade de autenticação;
- lifecycle cupom reserve/redeem/cancel e live intent bloqueiam concessão parcial.
  Enquanto essa paridade não fechar, ofertas com cupom permanecem guardadas.

Browser, após backend GREEN e janela coordenada: mesmos três placements storefront
e quatro displayModes widget, desktop +390px, mouse/teclado, mesmos componentes/CTA;
assertar número/body das requests e carrinho vindo da API, não só texto/toast.
422/409/rede preservam card e erro acessível; success só após ACK/experience validado.
Validar AUTH/CAPTCHA/support/embed renewal/payment-choice da4908 junto. Capturas
comparativas devem comprovar ausência de redesign. Fixture interceptada não prova
persistência: sandbox real precisa confirmar reload/checkout/DB do mesmo candidato.

## Sequência e autorização restante

Contrato/spec primeiro; teste RED; wiring/comando atômico por contexto; projeção
read/checkout/cupom; cliente com mesmo CTA; testes focados/typecheck/build; browser;
sandbox com fixtures sintéticas. Não ativar publicamente por ter só parser verde.
Escolha de armazenamento de emissão (se exigido body byte-idêntico), escopo cupom e
matriz de casos não suportados precisam decisão explícita; esta proposta não muda
schema, providers ou política comercial para contorná-los.
