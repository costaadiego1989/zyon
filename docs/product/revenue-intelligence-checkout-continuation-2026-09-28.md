# Revenue Intelligence — checkout após encerrar uma estratégia

Vigésima quinta entrega local. Sessões de um teste pausado, encerrado ou cujo prazo terminou podem continuar a compra pelo fluxo normal. O comprador não recebe controles técnicos de experimento. A participação original permanece imutável para medir inclusive compras tardias dentro da janela prevista.

## Comportamento e limites

A transição exige uma nova mensagem com recibo durável. Uma tentativa anterior com resultado incerto continua bloqueada até existir evidência de recuperação; encerrar o teste não autoriza reenviar chamadas. Mensagens já publicadas podem ser recuperadas pelo mecanismo existente, preservando sua referência de exibição. Requisições simultâneas continuam deduplicadas.

A continuação usa as condições atuais da loja e não consulta nem recebe o prompt ou a regra forçada de outro experimento. Cupons e descontos continuam sujeitos ao autorizador determinístico e à margem configurada. Desativar as flags do experimento não impede essa saída de uma sessão já participante.

A persistência de atribuição compara a sessão com o estado lido antes da oferta, sob bloqueio no PostgreSQL, evitando sobrescrever um carrinho alterado enquanto o provedor respondia. O sinal de solicitação de cupom é registrado antes dessa leitura para não disputar com a própria gravação.

Nesta continuação, ferramentas de IA não alteram o carrinho; os endpoints normais de carrinho continuam disponíveis. A paridade transacional dessas ferramentas e dos demais escritores de sessão ainda precisa ser concluída. As chamadas do fluxo normal não são contabilizadas como chamadas fixadas do experimento; a contribuição líquida e o custo total de IA seguem indisponíveis. Esta entrega não libera aprovação pública ou ativação.

## Evidência local

- Dez novos cenários PostgreSQL passaram na versão final: pausa, parada, prazo, compra tardia, tentativa incerta, ferramentas comerciais, cupom, alteração concorrente do carrinho, identidade/loja e recuperação com retries simultâneos.
- As baterias focadas de continuação, chat principal e pagamento cobriram 33 cenários PostgreSQL distintos com sucesso. Os logs têm sobreposição e suas contagens não devem ser somadas.
- Cinco testes do autorizador de ofertas passaram, incluindo a distinção entre regra experimental forçada e condições normais da loja, teto de desconto e margem insuficiente.
- TypeScript da API passou. Nenhuma migration ou mudança visual foi necessária.
- As suítes antigas de cadastro/contexto monetário tiveram 19 sucessos, oito falhas e um teste ignorado. As mesmas oito falhas foram reproduzidas com o código de produção do commit anterior `d9061f6`, por loader local de leitura, sem alterar o checkout de trabalho. Elas continuam pendentes e impedem afirmar sucesso global ou jornada completa.

Logs locais: `.audit/revenue-weekly/strategy-continuation-coupon-final.log`, `strategy-continuation-final.log`, `strategy-continuation-guarded.log`, `strategy-continuation-offers.log`, `strategy-continuation-types-final.log` e `strategy-continuation-baseline-tests.log`.

Os testes usam PostgreSQL descartável e provedores controlados. Não houve chamada externa, implantação, ativação ou comprovação de ganho comercial. Aprovação/ativação, paridade completa, economia integral, incentivos e aprendizado compartilhado continuam como trabalho restante.
