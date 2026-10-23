# Revisão do ciclo de reserva de cupom storefront

Data: 2026-10-18. Workspace: `C:/Users/Admin/Desktop/AACP-integracao`.

Escopo desta revisão: leitura do código e desenho de regressões. Nenhuma mudança de runtime, schema, migration, endpoint, layout ou provedor foi executada. Não houve banco, build ou chamada externa. Não há `AGENTS.md` no repositório nem nos diretórios ancestrais verificados; `CLAUDE.md` foi lido. A indicação antiga de custo presumido de 50% no guia não é autoridade: custo ausente continua recusado pelo engine atual.

## Conclusão

A aplicação do cupom no carrinho já possui transação única para reserva, outbox e CAS do carrinho. Isso NÃO fecha o ciclo carrinho → checkout → pedido. O ID da reserva é o `cartId`; o bootstrap normalmente cria outro ID (`chk_*`), e a baixa procura somente esse segundo ID. Remover cupom/limpar carrinho tampouco cancela a reserva. Manter o bloqueio comercial é seguro contra novo benefício combinado, mas não é uma solução funcional do ciclo.

Não basta procurar sessões por `cart_ref` antes de cancelar: o bootstrap pode persistir outra sessão depois dessa consulta. Uma correção precisa de fence comum entre criação/vínculo de checkout e liberação/mutação do carrinho, com vínculo durável e escopo estrito.

## Evidência atual

Todos os caminhos abaixo são relativos a `apps/api/src/`.

| Etapa | Evidência | Consequência |
| --- | --- | --- |
| Reserva atômica storefront | `modules/storefront/infrastructure/repositories/prisma-storefront-coupon-cart.adapter.ts:71` entra no UoW; `:80` consulta reserva pelo cartId; `:103` passa `session_id: scope.cartId` ao use case. | Reserva/outbox/CAS usam o ID do carrinho, não um checkout ainda inexistente. As factories DI recebem esse mesmo tx. |
| Persistência da reserva | `modules/coupons/infrastructure/repositories/prisma-coupon-transaction.repository.ts:40` usa unique merchant/session/coupon; `:52` conta status não cancelados; `:83` grava outbox na mesma transação. | `applied` e `redeemed` consomem limite; não se deve cancelar reserva paga para liberar quota. |
| Entrada do checkout | `modules/checkout/application/use-cases/start-checkout.use-case.ts:78` resolve o carrinho autoritativo antes do bootstrap. `modules/checkout/application/services/checkout-cart-authority.service.ts:25` lê o carrinho sem cart advisory lock até sua persistência em checkout. | A cotação autoritativa não é, por si só, um handoff transacional. |
| Identidade do bootstrap | `modules/checkout/application/services/checkout-bootstrap.service.ts:83` cria `chk_${crypto.randomUUID()}` quando o caller não fornece session_id; `:108` guarda somente cart_ref; `:111` cria a sessão; `:170` faz novo save. | Não há associação explícita de redemptionId nem transferência da reserva. O JSON cart_ref não fecha ausência concorrente. |
| Concorrência da criação | `modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts:253` cria por merchant/session. O ramo com execução estratégica toma merchant lock, e o outro faz upsert. | A unicidade da sessão não impede dois IDs diferentes de checkout para o mesmo carrinho. Nenhum ramo adquire o fence storefront-cart nessa criação. |
| Pedido concluído | `modules/checkout/application/use-cases/complete-order.use-case.ts:166` publica order.completed; `:169` envia input.session_id, sem origem da reserva. | O evento contém o ID do checkout, não o cartId original. Não inferir outro ID pelo texto/código do cupom. |
| Baixa do cupom | `modules/coupons/infrastructure/event-handlers/on-order-completed.handler.ts:24` repassa session_id ao use case; `modules/coupons/application/use-cases/redeem-coupon.use-case.ts:14` mantém o ID; `.../prisma-coupon-transaction.repository.ts:91` busca applied somente nesse ID. | Uma reserva aplicada sob cartId permanece aplicada quando cartId != checkoutSessionId. Ausência de linhas é tratada como sucesso sem efeito. |
| Remoção/clear | `modules/storefront/infrastructure/repositories/prisma-storefront-cart.repository.ts:71` limpa items/discount/couponCode; `:87` limpa couponCode/discount. Não altera coupon_redemptions. `modules/storefront/presentation/http/storefront.controller.ts:501` e `.../tool-handlers/cart.handlers.ts:451/:576` chamam esses métodos. | O carrinho perde o benefício visível, mas a reserva permanece ativa, consome quota e impede reaplicação. O clear legado também não redefine freeShipping: qualquer mudança disso exige contrato próprio, não ajuste incidental. |
| Cancel/reopen checkout | `modules/checkout/infrastructure/prisma/prisma-checkout.repository.ts:160` e `:219` cancelam applied usando checkoutSessionId. O método checa pagamentos/pedidos antes de invalidar. | A reserva original sob cartId não é abrangida. Alargar WHERE para cart_ref sem prova de propriedade poderia cancelar benefício de outra sessão/pagamento. |
| Fence existente de carrinho | `modules/storefront/infrastructure/repositories/storefront-cart-transaction.ts:54` usa chave JSON [storefront-cart,merchantId,cartId]; `:63` executa sob esse advisory lock até write+TTL. | É o namespace a reutilizar, não um lock novo desconectado. Todos os writers relevantes precisam respeitar a mesma ordem e lifetime. |
| Bloqueio comercial atual | `modules/storefront/infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.ts:21` bloqueia qualquer redemption não cancelada do cartId, sob cart lock em `:27` e `:64`. O adapter de cupom também bloqueia reserva já ativa. | Não remover esses gates. Após clear, o bloqueio é funcionalmente conservador, mas pode persistir indefinidamente. |
| Ordem de locks do checkout | `modules/coupons/application/use-cases/apply-coupon.use-case.ts:60` toma merchant → rules → session → coupon. `modules/payment/infrastructure/prisma-payment.repository.ts:219` toma merchant → payment-session advisory → session → cart refs ordenados em `:240`. | Não adquirir merchant/session depois do cart lock. Um hook dentro do core de carrinho que tente lockar checkout inverteria a ordem. |
| Ordem inversa na baixa | `.../prisma-coupon-transaction.repository.ts:95` atualiza redemption e só em `:101` atualiza coupon. Reserve toma coupon FOR UPDATE antes de tocar redemption (`:27/:40`). | Há ordem inversa potencial coupon → redemption versus redemption → coupon. Cancel/baixa devem usar ordem consistente; prova de deadlock exige teste real, ainda não executado. |
| Falhas do subscriber | `.../on-order-completed.handler.ts:35` captura e não relança erro. `shared/messaging/outbox-dispatcher.service.ts:155` aguarda handler e em `:157` marca como concluído. | Falha de baixa pode ser reconhecida como entregue sem retry durável. É pendência distinta do mismatch; não afirmar que o outbox atual recupera esse erro. |

O schema `apps/api/prisma/schema.prisma:1366` possui merchantId/sessionId/couponId/status/orderId e unique merchant/session/coupon; não possui FK de checkout nem cartId separado. Não se pode tratar o nome sessionId como prova de que todas as linhas são de checkout. A entidade (`coupon-redemption.entity.ts:46/:56`) só permite applied → redeemed/cancelled; reativação é outra transição explícita.

## Desenho mínimo proposto, ainda NÃO implementado

### 1. Identidade durável sem reescrever reservas antigas

Preservar a reserva storefront em seu ID original e persistir, na MESMA transação da criação do checkout, um vínculo interno versionado: merchantId, cartId, checkoutSessionId, redemptionId, couponId e discountCents autorizados. Usar JSON persistido já existente é uma opção sem DDL, sujeita à aprovação do contrato; o mapper/serializer público não pode vazar esse campo. O vínculo precisa sobreviver a save/refresh/recovery e não pode ser aceito de DTO/LLM.

Não trocar sessionId da reserva indiscriminadamente: isso quebra os gates de cartId, a idempotência e a comparação de limites. Não buscar por código/valor parecido nem considerar cart_ref suficiente para provar que aquela reserva financiou aquele pedido.

No bootstrap, reler carrinho/reserva após adquirir o fence, conferir snapshot monetário completo, cart_ref autenticado e comprador confiável, e só então persistir sessão+vínculo. A cotação que foi calculada antes de aguardar o lock pode estar obsoleta: revalidar ou abortar com conflito, nunca salvar desconto antigo sobre carrinho novo. Região/custo/policy ausentes continuam recusados. Nenhum novo desconto é concedido pelo lifecycle.

### 2. Fence e ordem de locks

Ordem compatível proposta para caminhos que já possuem checkout: merchant/configuração (ordem atual) → payment-session advisory quando aplicável → checkout session row → cart advisory (refs ordenados) → coupon rows em ordem estável → redemption rows/CAS → outbox. Não adicionar um lock de session depois de coupon/cart.

Operações somente de carrinho podem iniciar no cart advisory e consultar vínculos/estados sem tomar locks de merchant/session posteriormente. Isso só é correto se TODOS os writers de vínculo, handoff, admissão de pagamento e liberação relevantes também adquirirem esse mesmo cart fence antes do commit. Não é o caso do bootstrap atual. Mutação de vínculo por saveSession genérico precisa ser proibida ou passar pelo mesmo contrato; não basta o novo adapter respeitá-lo.

Checkout/payment podem descobrir cart_ref para ordenar locks, mas devem validar novamente esse vínculo sob os locks antes de decidir. Caso um vínculo/escopo novo apareça e exigisse adquirir lock anterior fora de ordem, abortar com conflito; não improvisar expansão/retry automático da transação.

Uma consulta que retorna zero sessões, mesmo usando JSON path por merchant, NÃO prova ausência futura. Sob o fence comum passa a ser útil porque o bootstrap também não pode inserir um vínculo entre a consulta e o commit do clear. Consulta e mutação devem estar na mesma transação. O banco atual não tem índice específico de cart_ref: registrar impacto de scan por tenant antes de eventual ativação; não adicionar migration nesta revisão.

### 3. Semântica mínima de handoff/cancelamento

- Antes de qualquer checkout proprietário: removeCoupon/clear cancela SOMENTE a reserva applied identificada e pertencente àquele carrinho; altera carrinho/CAS, quota lógica e evento cancelamento em um commit. Falha preserva carrinho/TTL/reserva/outbox.
- Havendo checkout proprietário ainda aberto: o menor comportamento seguro é recusar a liberação pelo carrinho e exigir o fluxo já existente de edição/cancelamento de checkout. Não cancelar por timeout do navegador, TTL do carrinho, ausência de callback ou simples leitura de paymentIntent vazia.
- Cancelamento/reopen do checkout passa a resolver o vínculo interno e cancelar somente sua reserva, após as verificações atuais de pagamento/pedido e sob fence. Um pagamento pending, requires_action, approved, in_flight/unknown/ACK perdido ou cancelamento externo incerto impede liberar quota. failed/cancelled isolados não substituem a prova de cancelamento final exigida pelo journal real.
- Pedido pago/concluído: baixa exatamente a redemption vinculada; nunca cancela redeemed para devolver limite. Replay do mesmo pedido é no-op comprovado; orderId/merchant/binding divergentes são conflito, não sucesso vazio.
- Linhas legadas sem vínculo confiável, múltiplos checkouts para o mesmo cart_ref ou divergência entre valor reservado e valor cobrado exigem revisão. Não fazer backfill presumido nem autocancelamento.
- Reutilizar o mesmo cartId após compra exige decisão explícita de ciclo do carrinho: redeemed continua consumindo quota e a unique atual impede reaplicar o mesmo cupom nesse ID. Não inventar nova identidade, retenção ou ciclo silencioso para contornar isso.

### 4. Contratos/arquivos da implementação futura

Proposta de porta de aplicação, não endpoint novo: `StorefrontCouponLifecyclePort` com operações transacionais `bindCheckout`, `releaseUnboundCartCoupon`, `cancelCheckoutCoupon` e `redeemBoundOrder`. Inputs só scope e referências server-owned; resultados discriminados strict Zod (bound/released/redeemed/already_current/blocked/conflict). Nunca retornar desconto aplicado antes do commit. Nome/shape finais dependem do plano do root.

Composição concreta no module, factories/readers tx-bound como no adapter39; application importa porta de domínio, não infraestrutura de outro contexto.

Arquivos inevitavelmente atingidos:

1. Novo port/schema e adapter lifecycle transaction-bound; testes unitários explícitos, sem fingir SQL proof.
2. `checkout-bootstrap.service.ts` + `prisma-checkout.repository.ts`/porta de sessão: criação atômica + vínculo/fence e preservação em saves. Não manter createSessionIfAbsent separado da gravação do vínculo.
3. `checkout-cart-authority.service.ts` e bootstrap: reler/revalidar o snapshot no handoff, sem ampliar descontos por falta de custo/policy.
4. `prisma-storefront-cart.repository.ts`/`storefront-cart-transaction.ts` + UoW/wiring: clear/removeCoupon/liberação compartilhada também nos endpoints e ferramentas; não corrigir só um handler.
5. `prisma-coupon-transaction.repository.ts`, `redeem-coupon.use-case.ts` e subscriber order.completed: baixa por vínculo exato, CAS, lock coupon antes de redemption, erro recuperável não reconhecido falsamente como entregue. Fluxo legado de cupom aplicado diretamente no checkout continua aceito pelo ID original, sem misturar as duas origens.
6. Cancel/reopen/commitCommercialMutation do checkout e aplicação direta de cupom: não liberar reserva vinculada a outro checkout nem criar segunda reserva para o mesmo benefício.
7. Admissão/first-send do pagamento: validar binding estável sob o cart fence que já existe; cancelamento incerto permanece bloqueado. Sem chamada de provedor dentro da transação.

Não remover guard37, não expor accept/endpoint novo, não alterar layout ou caps/margem. Uma integração parcial que só modifica order.completed não resolve a corrida bootstrap/clear.

## Testes primeiro — regressões executáveis propostas

### Fonte (rápidos, fakes declarados)

1. Aplicar reserva real em cartId → bootstrap real sem session_id → publicar order.completed pelo checkout ID real: esperar a mesma reserva redeemed e uma única incrementação/outbox. Deve ficar RED hoje; controle positivo usa session_id == cartId e passa. O emissor do evento pode ser dirigido diretamente como no contrato atual; isso não prova pagamento nem fluxo completo de pedido.
2. Mesmo roteiro com cupom aplicado diretamente no checkout para preservar legado; replay do mesmo evento não duplica usagesCount nem coupon.redeemed.
3. clear/removeCoupon antes do handoff: cancelar applied+limpar carrinho em um commit. Hook deve atender endpoint HTTP, tool e UoW, não só storefront chat.
4. clear/removeCoupon com checkout proprietário, pedido existente, pagamento ativo/unknown ou vínculo legado ambíguo: recusar, preservar snapshot/TTL/quota/outbox.
5. Handoff cruza alteração de snapshot/quantidade/preço/cupom após primeira cotação: conflito sem persistir benefício antigo, sem retry.
6. Vínculo de merchant/cart/checkout/redemption/coupon/valor divergente ou campo privado forjado em DTO: rejeitar antes da escrita; código/custo/buyer privado não vazam.
7. Falha DB/outbox/CAS: rollback completo. ACK perdido após commit: unknown, uma transação, sem retry. Subscriber falhou: não marcar handler entregue; redelivery posterior efetiva a mesma baixa uma vez.

### Nativo PostgreSQL descartável (janela root; NÃO executado nesta revisão)

Usar Prisma real, o harness de loopback existente e fixtures sintéticas mínimas de checkout_sessions, completed_orders, payment_intents, coupon/redemption/outbox e cart. Não rodar banco real de merchant nem alterar main schema. Gate sintético pausa transação mantendo advisory/row locks REAIS; testemunhas pg_locks/pg_stat_activity não substituem assertions de estado.

| RED obrigatório | Interleaving | Critério GREEN |
| --- | --- | --- |
| Mismatch cartId/chkId | reserve → bootstrap sem session_id → order.completed | Uma redemption original redeemed, orderId correto, usagesCount +1, um coupon.redeemed. |
| Consulta de ausência insuficiente | clear lê ausência de checkout; bootstrap cria vínculo antes de clear commit | Sob implementação corrigida, segundo caminho espera fence; jamais checkout descontado com reserva cancelada. Testar ambas as ordens. |
| Dois checkouts concorrentes | 20 starts, IDs diferentes, mesmo merchant/cart | No máximo um proprietário do mesmo benefício; demais conflito/retomada legítima, nunca duas cobranças financiadas pela mesma reserva. |
| Handoff vs remoção/cupom novo | bootstrap pausa sob fence; remove/clear/apply disputam | Uma ordem comercial serializável: vínculo válido ou liberação completa, nunca orphan/double grant. |
| Pagamento vs liberação | first-send mantém session→cart; clear/cancel disputa | Pagamento admitido impede cancelar reserva; cancel final conhecido primeiro impede admissão sobre binding antigo. unknown não libera quota. |
| Baixa vs cancel/reapply | ordem de coupon/redemption real em lados opostos | Sem deadlock por inversão de locks; não redeemed→cancelled; CAS count0/1; um efeito/evento. |
| Fault injection | erro após redemption, outbox, cart CAS e ACK commit perdido | Erro antes do commit reverte tudo; ACK perdido conserva um efeito e outcome unknown. |

Não adaptar os negativos para aceitar o bloqueio comercial como se fosse conclusão do lifecycle. Os casos só podem passar quando vínculo/fence/baixa/liberação estiverem conectados no fluxo real.

## Critérios para fechar a futura etapa

Os REDs precisam ser capturados antes do runtime; manter controles positivos, scopes de tenant e limites P+D/custo/margem. Source green não é native green; native green não é provider/payment production. A prova desta revisão é somente estática até o teste focal explicitamente acrescentado e registrado abaixo. Nenhuma autorização de liberar quota legada, mudar retenção ou reutilizar identidade foi presumida.

## Evidência focal executada após autorização do root

Novo teste isolado, ainda NÃO registrado no runner global: `apps/api/tests/storefront-coupon-lifecycle.characterization.spec.ts`.

Comando, executado a partir de `apps/api`:

```powershell
node --import ./tests/test-network-guard.mjs --loader ./tests/ready-prod-loader.mjs --test ./tests/storefront-coupon-lifecycle.characterization.spec.ts
```

Resultado observado: **2 testes; 1 passou, 1 falhou; 0 skip; 857.5243 ms; exit 1**.

- Controle positivo: reserva+checkout com o mesmo sessionId foi baixada; replay não duplicou usagesCount/coupon.redeemed.
- Regressão RED: bootstrap real sem session_id criou `chk_UUID`, preservou cart_ref e desconto. Subscriber/use case reais consultaram applied pelo checkoutSessionId; a reserva original do cartId permaneceu **applied**, quando a asserção exige **redeemed**.
- PrismaCouponTransactionRepository.reserve/redeem são código real. Os delegates de persistência são uma simulação explícita em memória que respeita os WHERE reais, sem aliases ocultos. CheckoutBootstrapService, sua entidade de sessão, CouponsOnOrderCompletedHandler e RedeemCouponUseCase são reais; armazenamento de sessão e barramento são os doubles in-memory existentes.
- O evento order.completed é publicado diretamente com os mesmos nomes/IDs do produtor atual; CompleteOrderUseCase/admissão de pagamento/provedor NÃO foram executados. Não é prova nativa, de isolamento, de concorrência, de pagamento ou de entrega externa.
- O RED foi preservado sem mudar expectativas para aceitar a reserva órfã. Nenhuma implementação financeira foi alterada para fazê-lo passar.
