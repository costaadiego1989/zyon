# Handoff de cupom: revisão de desenho executável, etapa40B

Data:2026-10-18. Workspace:`C:/Users/Admin/Desktop/AACP-integracao`.
Escopo: leitura; nenhum runtime/schema/migration alterado e nenhum banco,
build, provedor ou `.env` acessado. `CLAUDE.md` lido; não foi encontrado
`AGENTS.md` aplicável. Este documento não substitui os specs do root.

## Conclusão

É viável corrigir o mismatch **sem nova DDL**, preservando a reserva original,
por vínculo privado versionado em `checkout_sessions.cart`. Mas exige conectar
criação, saves, refresh, mutação/liberação, pagamento e baixa à mesma autoridade
transacional. Só adicionar `cart_ref` ao WHERE de cancel/redeem é inseguro.
Não há correção de uma linha que preserve integralmente os fences existentes.

Recomendação: concluir40A independentemente; em40B, usar JSON privado somente
se todos os caminhos abaixo forem cobertos. Se esse conjunto não couber no lote,
manter40B aberto, não chamar o simples resolver de IDs de lifecycle concluído.

## Opções e fronteiras

| Opção | Vantagem | Condição/risco |
| --- | --- | --- |
| JSON privado em `checkout_sessions.cart` | Sem DDL; o mapper e os saves já persistem cart JSON; não muda sessionId/capability nem jornada visual. | Sem FK/unique específicos para o vínculo. Exclusividade depende de fence comum e de impedir remoção/substituição por qualquer writer. Refresh substitui cart hoje. Queries por JSON precisam medir scan por tenant. |
| `featuresApplied` | JSON já existente. | Não recomendado: contrato atual contém flags booleanas de features; é usado por análise/pós-compra. Misturar identidade financeira nesse campo amplia semântica e consumidores. |
| Tabela interna dedicada | Permite constraints/FKs/índices próprios de ownership e consulta. | Requer contrato e migration revisados; não elimina a integração de bootstrap/save/payment/cancel. Não é necessária apenas para resolver o mismatch. |
| Transferir `CouponRedemption.sessionId` para checkout | Cancel/redeem tradicionais passam a encontrar a linha. | Isoladamente perde os gates/idempotência por cartId. Transferir junto com remover o benefício do carrinho muda continuidade/retorno à loja. Não recomendar como atalho sem decisão de produto e prova de todos os efeitos. |

Não reutilizar `orderId` como checkoutId, `buyerGlobalUserId` como vínculo,
`commercialNudge.ruleId` como autoridade privada, nem igualar cartId e checkoutId.
`embedCheckoutSessionId()` deriva o ID do nonce assinado; o controller rejeita
outro session_id. Alterá-lo quebraria a capacidade existente.

## Evidências no código atual

Referências relativas a `apps/api/src/`; preferir os símbolos, pois40A está em edição.

- `embed/domain/embed-checkout-session.ts:5`: ID de checkout assinado distinto.
- `embed/presentation/http/embed-checkout.controller.ts:167`: repassa cartRef do
  token, não aceita o ref/identidade do browser como autoridade alternativa.
- `checkout/application/use-cases/start-checkout.use-case.ts:74`: resolve preço e
  origem antes do bootstrap; isso não mantém um lock até persistir o vínculo.
- `checkout/application/services/checkout-bootstrap.service.ts:83/111`: cria pelo
  checkoutId; `:108` grava cart_ref; `:148` reconstrói o objeto cart em refresh.
- `checkout/infrastructure/prisma/prisma-checkout.repository.ts:104/172/253`:
  saveSession, saveSessionIfUnchanged e os dois ramos de createSessionIfAbsent são
  entradas distintas. Os mappers `:800/823` escrevem o cart completo.
- Mesmo repository `:134/205`: mutação e reopen checam estado financeiro, mas
  cancelam reserva usando checkoutSessionId. Não substituí-los por updates soltos.
- `payment/infrastructure/prisma-payment.repository.ts:217`: admissão/first-send
  já usa merchant→payment-session→checkout row→cart refs ordenados.
- `checkout/domain/services/payment-cart-fingerprint.ts:6`: fingerprint público
  financeiro cobre itens/valores/frete, não identidade da reserva ou JSON privado.
  Igualdade do valor não prova ownership do cupom; validar vínculo separadamente.
- `checkout/application/services/checkout-experience.service.ts`: projeção pública
  explícita, não cart inteiro. Isso ajuda, mas não certifica todos os serializers.
- `checkout/domain/services/checkout-benefits-policy.ts:26`: cupom existente é
  reconhecido por commercialNudge.kind=coupon, não por desconto numérico sozinho.
- `coupons/application/services/checkout-coupon.ts`: projeção existente do cupom
  identifica o benefício e permite preservar a apresentação atual sem nova UI.

## Contrato privado mínimo, ainda proposta

Manter `CouponRedemption.sessionId=cartId` para reservas de origem storefront.
Vínculo server-owned identificado por versão, merchant/cart/checkout/redemption/
coupon, contribuição D em centavos e hash da base comercial autorizada. Se houver
reativação/rebinding, identidade/generation própria do vínculo deve impedir ABA.
Não aceitar esses campos em DTO/LLM; não usar valor/código parecido como lookup.
Status monetário continua no redemption; não inventar um segundo ledger de usos.

O vínculo precisa permitir localizar **um proprietário ativo**, distinguir
revogação de pagamento/baixa e recusar múltiplos donos. Mesmo redemptionId pode
ser reutilizado pelo repository após cancelamento; apenas comparar esse ID não
prova que um vínculo antigo voltou a ter autoridade. Fechar o vínculo anterior
sob fence antes de reativar/reaplicar é requisito, não nova política pós-compra.

## Ordem compatível e regras de ownership

Checkout/handoff/payment/cancel: merchant/config quando usados pelo caminho →
payment-session advisory quando aplicável → checkout row → cart advisory com
refs em ordem estável → coupon rows ordenadas → redemption/CAS → outbox.
Não introduzir cart→checkout ou cart→merchant em hooks de carrinho.

Cart-only começa no cart fence e pode ler vínculo/estado sem tomar depois locks
anteriores. Só é seguro se TODOS os writers que criam/trocam/revogam esse vínculo
também entram no mesmo cart fence até commit. SELECT de ausência sem participação
da criação não bloqueia inserção futura; advisory isolado no cancel não resolve.

Para sessão ainda ausente, o lock de row não existe: a criação precisa participar
explicitamente do fence antes de inserir. Os dois ramos de createSessionIfAbsent
e o create de saveSession devem ser cobertos, não só o bootstrap mais comum.
Descobrir refs para ordenar locks exige releitura/validação após adquiri-los;
mudança de identidade que exija lock anterior resulta em conflito, sem retry cego.

## Matriz de integração indispensável

| Caminho | Regra necessária |
| --- | --- |
| Primeira criação | Entrada interna separada recebe origem autenticada. Sob locks, reler snapshot, reserva, comprador e autorização de valor; sessão+vínculo no mesmo commit. Nenhuma reserva adicional nem duplicação de quota. |
| Bootstrap repetido / dois tokens | Mesmo dono/basis é retomada; checkoutId diferente não adquire a mesma reserva. Validar comprador/owner antes de criar autoridade. Não rebater o checkout vencedor com o snapshot perdedor. |
| saveSession / saveSessionIfUnchanged | Preservar e validar o vínculo canônico do storage; proibir inserção, perda, substituição ou reativação por snapshot genérico. Hash/CAS deve considerar a autoridade privada sem aceitá-la do cliente. |
| refreshCart/recovery | O `...enrichedInput.cart` atual não preserva campos privados. Recuperar vínculo canônico ou invalidá-lo transacionalmente conforme contexto; copiar desconto/nudge anteriores não é prova. |
| Mutação comercial | Conservar version/CAS, closed-session, estratégia e payment fences existentes. Invalidar a reserva EXATA vinculada, não todos os applied encontrados por OR de IDs. |
| Reopen | Manter CancelCheckoutPaymentUseCase: cancelamento externo incerto/unsupported/paid não é final. Só liberar a reserva após a confirmação e a rechecagem atuais no repository. |
| Payment admission / first-send | Sob merchant/payment/session/cart locks existentes, validar binding ativo, tenant, comprador, redemption, cupom, basis e contribuição D atual. Não confiar apenas no fingerprint de valores. Reconciliação/receipts posteriores não podem ser bloqueados como nova admissão. |
| Baixa | Evento continua com checkoutId. Resolver vínculo privado e baixar redemption EXATA da origem. O redeem genérico por cartId pode abranger várias linhas legadas: não basta encaminhar outro sessionId. Replay do mesmo pedido é no-op; owner/order divergente é conflito. |
| clear/remove antes de dono | Cancelar só a reserva aplicada certa e limpar o benefício/carrinho no mesmo commit; falha não renova TTL nem deixa liberação parcial. |
| clear/remove com dono | Não liberar por leitura de ausência de pagamento/TTL/browser. Recusar ou usar o fluxo de edição/cancelamento já aprovado, conforme decisão de jornada; não criar automaticamente checkout/carrinho novo. |

`recordEvent` e appendChatTurn/appendChatExchange escrevem score/history/payment
selection, não cart inteiro; não precisam ganhar locks financeiros só por isso.
Entretanto writers de cart fora do repository, como incentive-execution-ledger,
precisam provar preservação/não combinação ou recusar explicitamente sessões
vinculadas. Flags desligadas em um teste não provam fechamento de todos os writers.

Manter commercialNudge/appliedBenefits de cupom com a projeção existente. Um
currentDiscount positivo sem provenance de cupom pode ser tratado como incentivo
genérico pelo benefits policy; isso não deve autorizar trocar a contribuição
reservada sem reconciliar sua identidade. Preço P, contribuição D, custo/margem e
teto devem continuar coerentes; lifecycle não concede novo benefício.

JSON privado deve sair de respostas browser/SDK/ACP, prompts, logs e eventos
genéricos. A experiência e cartSummary atuais selecionam campos explicitamente,
mas ainda é preciso teste negativo com um canário do vínculo em cada serializer
aplicável. Não adicionar binding ao shared SDK público por conveniência.

## Provas executáveis mínimas para40B (não executadas aqui)

1. Preservar RED cartId/chkId e controle positivo atual; GREEN somente com mesma
   reserva baixada, um usage/evento, tenant/order corretos e replay sem efeito.
2. Native Prisma, dois lados de bootstrap↔clear/remove: gate SQL mantém locks
   reais; um espera o outro e nunca existe checkout descontado com reserva liberada.
3.20 starts com checkoutIds distintos para o mesmo cart: um dono por reserva,
   nenhum segundo financiamento. Fresh token/refresh não transfere owner sozinho.
4. Native first-send↔liberação e reopen: pending/requires_action/approved,
   creation/cancellation in_flight/uncertain e ACK perdido nunca liberam quota.
   Provider não entra na transação; testes usam o journal real com dados sintéticos.
5. Repetir save comum/CAS, bootstrap existente, refreshCart e recovery com vínculo;
   tentativa de remover/substituir JSON e stale version falha sem efeitos parciais.
6. Cancelamento→reaplicação: vínculo antigo não recupera autoridade só porque o
   mesmo redemptionId/valor reapareceu; quota correta e nenhum duplo owner.
7. Falhas após vínculo/reserva/outbox/CAS e falha deferred commit: rollback total;
   wrapper que lança após commit real: unknown, sem reexecutar nem realocar owner.
8. Binding forjado, merchant/cart/checkout/buyer/amount divergentes, múltiplas
   linhas legadas ou múltiplos possíveis checkouts: revisão/conflito, sem backfill.
9. Canary privado ausente de experiência, respostas, SDK e prompt exportado;
   desconto/cupom continuam apresentados nos componentes/fluxo atuais.

## Limites de encerramento

40A corrige ordem/falha de baixa, não o handoff. JSON privado é um desenho viável,
não código executado nem garantia de exclusividade por constraint de banco.
Tabela dedicada melhora enforcement, mas não torna um patch parcial completo.
Não alterar retenção, migrar reservas antigas por inferência nem reabrir/redimir/
cancelar um pedido pago para reutilizar o mesmo cartId. Um novo ciclo de compra
após conclusão é decisão separada, não solução implícita para este mismatch.

## Continuidade40B1 — contrato puro e próximos adapters

Root implementou checkout/domain/services/checkout-coupon-binding.ts após os
testes, sem conectá-lo ao runtime. Contrato: geração UUIDv4, identidade completa,
estado fechado, D positivo em centavos/hash e referência imutável do pedido.
Plano de baixa exige também a redemption exata. Null no comprador original da
reserva precisa ser explícito e coincidente, não wildcard; buyer do checkout é
separado. D=0 não representa autoridade de cupom de frete. Testes puros não são
prova de propriedade/ABA/fence no banco. Resultados atuais ficam no relatório
storefront-contracts.md, não nesta revisão inicialmente somente leitura.

Revisão adicional dos agentes confirmou dois ajustes importantes para40B:

1. **Storage-only:** o mapper atual devolve row.cart inteiro; GetCheckoutSession
   devolve sessão completa e StartCheckout envia cart ao recommender. Futuro
   splitStoredCheckoutCart/joinStoredCheckoutCart deve omitir campo privado do
   Cart público e preservar o canônico em saves, CAS, refresh e writers diretos.
   Entrada de origem autenticada deve ficar fora do DTO, num método dedicado de
   criação autoritativa; o create genérico não pode emitir vínculo.
2. **Autoridade congelada:** referência privada como irmã de creation.input em
   payment_intents.creation, nunca no input que ResumePaymentCreationService
   repassa ao PSP. assertSamePaymentIdentity deverá fixá-la. Approval reader
   fornecerá projeção interna estreita; após validar providerPaymentId definitivo,
   construir referência com orderId e persistir em order.completed no mesmo
   commit do pedido/outbox. Job filho preserva a referência, não consulta cart
   atual para reconstruí-la. Não reutilizar lineItemsJson/fulfillmentJson.

Sem isso, evento atrasado com apenas checkoutId/orderId pode selecionar uma nova
geração após cancel/reapply, mesmo quando o redemptionId original é reutilizado.
Comparar apenas id/valor/updatedAt não resolve esse ABA. Tombstone e referência
congelada precisam ser persistidos sob o fence comum; o planner puro não cria
essa garantia. Nenhum desses novos writers está ativo no lote40B1.

## Atenção à retomada de capability na emissão40B futura

Leitura adicional durante40B2: embedCheckoutSessionId já possui exceções assinadas
whatsappCheckoutSessionId/recoveredCheckoutSessionId, além do derivado de nonce.
Isso NÃO autoriza transformar cartId em checkoutId nem aceitar alias do browser.
EmbedCheckoutController exige trustedBuyer e correspondência do comprador para
recovery; RenewStorefrontEmbedSessionService preserva o binding do token anterior
com checks de merchant/cart/origin/env/installation e escopos limitados.

Antes de emitir vínculo, testar também clique repetido/fresh token e retomada no
mesmo carrinho, mantendo a jornada atual. Preferir o protocolo de continuação já
existente quando aplicável; não inventar novo nonce privado nem ampliar recovery
para anônimos sem verificar as guardas atuais. Dono diferente não pode financiar
a mesma reserva. Contrato de storage40B2 não resolve emissão/retomada por si só.

## Continuidade40B3 — revisão de implementação, sem issuer ativado

Journal agora suporta somente a preservação de `creation.couponAuthority`, irmã
de input. Identidade estrita40B1 reutilizada sem state/orderId; comparar presença
e valor simetricamente, incluindo ausência legada. Rehydrate recusa descriptors
que a cópia apagaria, fixa snapshot parseado e valida identidade completa do input
PSP contra o journal vinculado. Isso não autentica origem nem permite admissão:
guard40B2 permanece e prepareCreation não recebe/emite autoridade. Approval reader,
referência no pedido/evento/filho e baixa exata ainda não foram conectados.

Revisão paralela identificou o próximo protocolo mínimo necessário:

- Anchor determinístico por tenant/checkout ANTES do primeiro read/row lock/create,
  cobrindo ausência da linha. Ordem: merchant/config quando aplicável → payment
  advisory existente quando aplicável → checkout anchor → checkout row → cart
  advisories ordenados → coupon → redemption/outbox. Não inserir anchor dentro
  de save quando o caller já segura row lock; revisar TODOS os entrypoints.
- Cinco caminhos reais de criação: saveSession create, ambos createIfAbsent,
  telemetry upsert e WhatsApp route-to-session. Seed/QA não prova fechamento de
  request. Upsert padrão fora da TX também precisa participar do protocolo.
- Carrinho já possui advisory central em storefront-cart-transaction; getOrCreate
  também escreve TTL. Cart-only deve observar bindings canônicos por tenant/cart
  APÓS obter esse lock e recusar quando owned; nunca adquirir checkout lock depois
  do cart. Query de descoberta não transfere propriedade nem autoriza backfill.
- Issuer espera cart e RELÊ snapshot/reserva/custo/buyer/D/basis dentro do fence.
  Leitura anterior à espera não é lease. Dois checkouts para o mesmo cart devem
  encontrar um único owner;20 IDs distintos exigem teste SQL próprio.
- Bootstrap atual hidrata comprador reconhecido DEPOIS do create e pode chamar
  commitCommercialMutation mesmo sem mudança;40B2 recusaria binding nesse ponto.
  É necessário preparar hidratação antes do comando atômico ou integrar comandos
  bound dedicados antes da emissão, sem perder os dados fornecidos pelo usuário.
- CheckoutPanel hoje obtém token novo sem previous ao remontar. Renew existente
  preserva capability, mas fresh token produz outro checkoutId. Não resolver por
  OR(cart_ref), transferência da reserva ou escolha automática de owner. Fechar
  continuidade autenticada existente antes de ativar owner único na jornada.

Matriz concorrente pendente: ausência de checkout↔bootstrap/telemetry, issuer↔
clear/remove/apply dos dois lados, rollback do issuer,20 IDs distintos por cart,
first-send↔release e lock-order watchdog. Somente após esses fechamentos e
autoridade congelada no pedido/baixa, tornar GREEN o RED cartId/chkId.

## Continuidade40B4 — anchor implementado, issuer ainda ausente

O primeiro requisito acima foi implementado nos18arquivos de wrappers/criação,
com helper transacional comum. Inclui FOR SHARE de estratégia/chat, ambos
createIfAbsent,create de save e WhatsApp/telemetry. GET/preflight não ganham
anchor nem viram lease. Default create agora dentro TX; P2002 só relê após sair
de TX abortada. Address marketplace adquire merchant antes de anchor/row, pois
seu nested save pode pedir merchant quando incentivo está habilitado.

Native32/32 comprova exclusão por tenant/CHECKOUT, inclusive ausência:20starts
uma criação/19retomadas,rollback/ACK perdido,tenant independente e nestedlocks.
Metadata de binding semeada somente no teste, sem reserva autoritativa emitida.
Essa prova NÃO é20checkouts distintos para um mesmo cart. Falta integrar o cart
fence e o issuer, hidratação/customer/shipping/benefits/pagamento normais, retomada
autenticada/fresh token, captura canônica no journal/pedido e baixa/liberação.
Enquanto isso,guards40B2 e RED principal mantidos. Em rollout futuro, todos os
writers precisam estar atualizados antes de ativar emissão; teste local não
certifica convivência com pods antigos. Nenhuma emissão/ativação por flag nova.

## Continuidade40B5 — proteção cart-side implementada, sem issuer real

Lote43 implementa descoberta sob cart advisory com snapshot READ COMMITTED,
tenant/cart/checkout/buyer/cart_ref estritos e parser privado; múltiplos ou
malformados conflitam. Sete mutadores e UoW antes de callback/efeitos, inclusive
cupom, cross-sell e add marketplace. getOrCreate vinculado só lê row existente,
sem TTL/upsert/reprice/callback, inclusive expirado; ausência não recria.
Estados released/redeemed também continuam protegidos até lifecycle dedicado.
Native30/30 prova20cartwaiters e ambas ordens com SIMULADOR TEST-ONLY;não prova
20checkouts distintos com dono único,emissão autoritativa ou baixa real. Nenhum
callsite emite binding na aplicação. Guards40B2/40B3 e RED principal preservados.

Próximo recorte: antes de ligar o emissor, provar contrato de handoff interno que
recebe origem autenticada fora do DTO público e prepara buyer/customer antes
do binding. StartCheckoutUseCase resolve storefront antes de bootstrap e
CheckoutBootstrapService ainda hidrata comprador após create, faz refresh e
saves genéricos: não anexar binding ali sem integrar essa sequência e a retomada
autenticada do checkout original. Sob merchant/config→checkout anchor/row→cart
fence, emissor precisa reler snapshot/reserva/buyer/D/custos/basis após esperar.
Nenhuma leitura prévia é lease; não mover reserve.sessionId,escolher dono por
cart_ref ou transferir authority para novo nonce. Captura imutável no journal,
pedido/evento/filho e baixa/liberação exatas vêm depois, antes de ativação.
JSON discovery não tem índice novo: testar custo por tenant e versão de todos
os writers antes de qualquer rollout. Estado final dos gates no relatório atual.

## Continuidade40B6/lote44 — baixa exata candidata, ainda sem ativação

PrismaBoundCouponRedemption recebe apenas merchantId/eventId,carrega authority
V1 de order.completed persistido e exige journal preservado/valor aprovado/pedido
compatíveis. Transação liga redemption EXATA,usage,binding/version e receipt
determinístico;replay só com trio coerente,sem recompor pelo cart atual. Não está
em DI/handler/controller. Native21/21 (20concorrentes) usa upstream semeado e
nenhuma tabela storefront_carts:prova o comando,não issuer/captura/webhook reais.
Helper de cart advisory compartilhado foi movido para shared/persistence com
reexport compatível;nenhuma supressão de lint de dependências ou lock novo.

Próximo callsite NÃO deve desviar o handler legado só por encontrar cart_ref.
Primeiro emitir sob origem autenticada/continuidade/hidratação,admitir e capturar
authority canônica como irmã de creation.input no pagamento. Approval reader
interno precisa entregar essa authority preservada;publisher deve formar orderId
somente após verificar providerPaymentId e gravar pedido+referência no evento no
mesmo commit. Nenhuma authority extra do body/DTO/LLM ou input PSP.

Só depois integrar handler: presença de authority inválida não cai no redeem
legado. Retry durável precisa preservar geração/referência da fonte,sem procurar
cart atual. Novo comando depende de fonte/receipt retidos: não remover registros
referenciados por operação pendente nem implementar prazos sem decisão aprovada.
Ausência/corrupção é revisão explícita, não reconstrução automática/backfill.
Emissor,continuidade,captura,handler/retry/release e jornada permanecem abertos;
o RED principal não foi alterado. Gates atuais no relatório storefront-contracts.

## Continuidade45 — preservar taxas e transportar leitura privada, sem emissão

Revisão encontrou igualdade indevida payment.amountCents==orderTotal no comando
44. Lote45 usa breakdown canônico validado por Zod e política monetária EXISTENTE:
total merchant exclui platformFee,approved amount continua integral e desconto
precisa coincidir com authority. Não inferir taxa pela diferença. Null/ausente
legado exige igualdade exata. Reserva continua positiva;pedido zero exige
pagamento positivo verificado. Replay não reescreve valores nem cobra nova taxa.

Reader interno EXISTENTE PrismaPaymentApprovalReader entrega opcional authority
estrita/detached do journal e valida identity/input,método e tenant/checkout/id.
Não entrega creation/input/lease,shape legado continua sem chave opcional. Essa
preparação read-only NÃO é captura/issuer. CompleteOrderUseCase e subscribers
não foram ativados para emitir/consumir a nova authority neste lote.

Próximo publisher precisa usar exclusivamente essa leitura preservada e congelar
orderId após aprovação verificada. Entregar publisher E consumer/retry juntos,
com referência durável da fonte,sem fallback legado quando authority está
presente/inválida. Só ativar após issuer/continuidade/buyer hydration/captura sob
fences e política de recuperação de fontes pendentes. Não apagar fonte ou recibo
nem reconstruir do carrinho vivo. Gatilho de emissão não foi adicionado.

## Continuidade46 — remount/reload ordinary na aba preservam proof, não ownership

CheckoutPanel e CartProvider usam recurso explícito de continuidade por origem/
merchant/cart,com single-flight e sessionStorage+fallback em memória. Retomada
sempre revalida no server com previous_embed_token e prova atual de conversa/
buyer. Denial não apaga proof nem faz fresh fallback. Clear invalida receipt
atrasado local,sem liberar estado no servidor. JSX do painel igual ao HEAD após
normalizar CRLF;nenhum novo CTA/modal/layout. Fluxo recovered separado mantido.
Frontend299/299 e browser5/5(4cenários) com React/painel reais mas upstream/widget
FILHO sintéticos. Signer/Renew reais em23focais API com ports sintéticos;nenhuma
prova de issuer SQL ou compra real. Não confundir20starts coalescidos no browser
com20checkouts distintos sob dono único no banco.

Antes do issuer,continuam pendentes buyer/customer hydration e retomada server
quando proof falta/emissão ACK perdida/aba nova/proof>1dia. Não apagar prova
recusada no browser para criar outro nonce. Server deve decidir continuidade e
ownership sob fence,sem escolher checkout via cart_ref ou aliases do cliente.

Nova descoberta de gate fora do registry:native-storefront-checkout.spec usa
catálogo nativo com DOUBLES,não PostgreSQL. Fixture foi completada com base2000,
descriptor10% e policy15%explícitos,sem alterar asserts18/22.5/63/desconto1.
Agora4pass/1fail porque opções/adicionais não têm custo comprovado para desconto.
Controle sem benefício mantém20/25,total70,quantidades1/2 e opções. Não inventar
custo do adicional,reutilizar custo-base como total ou relaxar margin engine;
mapear fonte comercial antes de integrar issuer para esse caso. RED principal
cartId/chkId continua separado. Sem captura/payment/order/baixa/release ativados.
