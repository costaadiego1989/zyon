# Pagamentos — API-012 a API-015

Terceira etapa da API, branch `fix/ready-to-prod-audit`. Implementação local; produção continua NO-GO. Resultados consolidados: [registro da etapa](CORRECOES-ETAPA-3.md).

## Criação e recuperação

A intenção nova persiste versão, composição do valor e entrada do provedor antes de executar a criação externa. O estado de execução distingue `ready`, `in_flight`, `uncertain` e `complete`; um lease e comparação da versão elegem uma tentativa. Repetição com a mesma chave usa a intenção existente e rejeita troca de método, oferta ou fingerprint do carrinho. As entradas não armazenam cartão, CVV ou credenciais do provedor. `creation` e a versão interna não são devolvidas pela resposta pública de criação.

As chamadas financeiras deixam de usar o retry genérico do HttpClient. Asaas recupera uma cobrança por `externalReference`, conferindo referência, cliente, modalidade e valor; não repete o POST após resultado incerto. Ausência de resultado, múltiplos resultados ou dados incompatíveis não comprovam ausência de cobrança. O estado permanece incerto e exige nova consulta ou conciliação manual. O endpoint oficial permite esse filtro e é indicado para consultas e conciliação: [listar cobranças Asaas](https://docs.asaas.com/reference/listar-cobrancas).

Stripe reutiliza a chave e os parâmetros persistidos somente dentro da janela conservadora de 23 horas desde a primeira tentativa. Depois disso, consulta a intenção por metadata e não cria outra por resultado vazio. A documentação permite remoção de chaves após pelo menos 24 horas e avisa que a pesquisa não oferece leitura imediatamente consistente: [idempotência Stripe](https://docs.stripe.com/api/idempotent_requests), [pesquisa de intenções](https://docs.stripe.com/api/payment_intents/search). O limite de 23 horas é uma decisão conservadora deste patch, não uma garantia adicional oferecida pelo provedor.

A rota de criação e o fingerprint da conta do provedor ficam persistidos para impedir mudança silenciosa de provedor/conta durante a recuperação. Mudança de credencial que altera esse fingerprint pode exigir revisão manual. Mercado Pago possui consulta de recuperação, mas seus fluxos reais e os demais adaptadores continuam sujeitos a testes por provedor. Cripto sem recuperação utilizável permanece incerto, sem fabricar outra transferência.

A reconciliação tenta recuperar intenções sem ID externo. Uma queda entre salvar `ready` e adquirir a execução permite criação posterior; uma queda após adquirir execução pode ser indistinguível de uma cobrança aceita. Não foi criado comando operacional para resolver todos os estados incertos nem uma inbox completa para todos os webhooks. API-013 permanece parcial.

## Valor e confirmação

`amountBreakdown` registra subtotal dos itens, desconto, frete, taxa da plataforma e total em centavos, moeda e fingerprint do carrinho. Novos valores precisam ser inteiros válidos e somar exatamente. A taxa não é recalculada durante a aprovação a partir de configuração que possa ter mudado. Stripe mantém o destino conectado também quando a taxa é zero.

O checkout lê a aprovação persistida, confere tenant/sessão/provedor/valor e compara o carrinho antes de criar um pedido novo. O body público não autoriza uma taxa. SKU ou variante diferente de mesmo preço são rejeitados. Um pedido compatível já gravado é reconhecido como replay mesmo que o carrinho seja editado depois; o evento de estoque continua contendo os itens originais. Intenções legadas sem composição/fingerprint não recebem um histórico inventado; casos de taxa antiga ou carrinho alterado exigem conciliação.

Se o comprador efetivamente pagar uma intenção antiga após alterar o carrinho, a rejeição protege a conclusão incorreta, mas não devolve automaticamente o dinheiro. Cancelamento, expiração e reconciliação desse cenário com o provedor continuam gates. A correção não encerra os contratos de UI, polling ou renderer do widget_v2.

## Concorrência, eventos e cripto

Updates da intenção comparam a versão persistida e preservam identidade, composição do valor e parâmetros de criação. Aprovação/falha/reembolso e seu evento de mudança de status são gravados na mesma transação; um writer perdedor não sobrescreve o vencedor nem emite seu evento. O handler `payment.complete-approved.v1` retoma a conclusão após queda entre a aprovação e a criação do pedido. Reembolso recebido antes da aprovação exige retry, em vez de ser absorvido como conclusão válida.

A conclusão imediata e o retry durável podem invocar o mesmo caminho. Pedido e efeitos de estoque têm seus próprios controles de idempotência. A mensagem de confirmação usa recibo determinístico e lock da sessão, gravando recibo e mensagem na mesma transação sem substituir o carrinho inteiro. O antigo `paymentConfirmed` não era persistido pelo mapper; a regravação sem efeito foi removida. A máquina de etapas do chat e sua experiência nos fronts não são declaradas corrigidas por isso.

Reservas de hash cripto aprovadas, reembolsadas ou ainda verificáveis não são removidas pela compensação de erro ou apenas por expiração. Só intenções em estado terminal não pago (`failed`/`cancelled`) podem liberar a reserva sob lock. Isso impede que outra verificação aprove depois de uma liberação indevida. Uma reserva ambígua pode exigir conciliação manual; não foi adicionado um protocolo completo de retomada de verificações cripto.

Os marcadores de webhook anteriores ao dispatch ainda não constituem uma inbox transacional de todos os eventos recebidos. Uma queda entre gravar o marcador e executar seu efeito continua exigindo reconciliação. A ordem entre eventos externos, reversões e seus efeitos de negócio também não é garantida apenas pelo CAS. Por esses limites, API-015 permanece parcial; não há alegação de processamento global exatamente uma vez.

## Validação e rollout

As regressões exercitam referência externa, resultado ambíguo, retries Stripe dentro/fora da janela, composição do valor, fingerprint, concorrência de criação e transição, rollback de outbox, recuperação após commit local malsucedido, confirmação duplicada e preservação de hashes cripto. PostgreSQL real usa schema exclusivo; o SQL aditivo é executado separadamente para verificar preservação de registros antigos e constraint de versão.

Aplicar `20260906010000_payment_recovery_cas` após a baseline ativa e drenar escritores antigos que ignoram versões e estado de criação. Revisar intenções e marcadores legados antes de reenviar cobranças. A migração não altera estados financeiros históricos nem assume que timeout significa cobrança inexistente. Todos os provedores nos testes são doubles ou transporte interceptado; nenhum pagamento real, sandbox externo, estorno ou repasse foi executado.
