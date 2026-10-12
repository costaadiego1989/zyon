# Proteção de benefícios nas alterações do checkout conversacional

Data: 29/09/2026. Continuação do plano de Revenue Intelligence, entrega 37. Implementação local, sem publicação ou ativação de incentivos pela IA.

## Comportamento

Cadastro e correções de comprador, reconhecimento após verificação de e-mail, preenchimento/recusa de endereço e seleção de frete passam pela mesma transação comercial usada no ACP. Uma mudança de identidade, destino, carrinho ou frete remove os benefícios incompatíveis e cancela as reservas de cupons aplicados junto com a gravação da sessão.

Exemplo: um cupom aplicado em uma compra para São Paulo não permanece automaticamente válido depois de uma mudança de destino pelo chat. O desconto e sua reserva são removidos; uma nova aplicação precisa passar pelas regras atuais. Reconhecer uma conta após OTP também não transfere um cupom reservado para a identidade anônima anterior.

Alterações de nome, confirmação do mesmo endereço e correções sem mudança comercial preservam os benefícios. O retorno do serviço usa a sessão confirmada pelo banco, incluindo sua versão atual. Cada transação compara a versão e o conteúdo originais e recusa sobrescrever uma compra alterada por outra requisição, concluída ou explicitamente cancelada.

A retomada com atualização de carrinho também usa essa transação antes de hidratar o comprador. Mantém um cupom de produto quando o contexto continua igual e descarta descontos enviados no novo carrinho. Mudanças comerciais cancelam a reserva anterior antes da continuação do checkout.

## Falhas e concorrência

- Falha ao cancelar a reserva desfaz a alteração de comprador/endereço/frete/carrinho; não deixa um desconto removido com capacidade ainda ocupada.
- Consultas de CEP, transportadora, reconhecimento e envio de OTP continuam fora das transações de banco. Respostas atrasadas não autorizam gravar sobre uma sessão mais recente.
- Conflito ao persistir uma cotação é propagado; não é tratado como falha da transportadora para tentar salvar uma estimativa com dados antigos.
- Ao corrigir e-mail, a revogação da identidade e do benefício anterior ocorre antes do novo envio de OTP. Uma falha de entrega preserva essa revogação. Não existe atomicidade entre entrega externa e banco; um envio aceito seguido de conflito não autoriza salvar o código sobre outra versão da compra.
- A atribuição original do experimento não é recriada. A proteção de contexto experimental existente continua valendo.

## Validação local

Passaram 95 testes de integração no PostgreSQL nativo descartável de `127.0.0.1:5557`, com o cliente Prisma isolado. Incluem 27 cenários novos e regressões de cupons, PATCH ACP, versões concorrentes e jornadas de compra nos dois grupos experimentais. Logs: `.audit/revenue-weekly/chat-commercial-pg-final.log`.

Também passaram 69 testes de aplicação e o TypeScript da API. Um teste antigo de bloqueio de cadastro duplicado continua explicitamente ignorado na suíte. Logs: `.audit/revenue-weekly/chat-commercial-unit-final.log` e `.audit/revenue-weekly/chat-commercial-types-final.log`.

Na primeira execução de integração, 32 de 33 cenários passaram. O teste de reconhecimento ainda esperava reutilizar o frete da identidade anônima: foi corrigido para exigir seleção de uma cotação atual e então chegar ao pagamento. A bateria final de 95 cenários passou integralmente.

Os testes usam transportes controlados e não enviam mensagens, pagamentos ou requisições a provedores externos. Não houve nova validação de navegador, Redis real ou implantação nesta entrega.

As primeiras baterias de aplicação encontraram fixtures antigas de confiança de identidade e seleção de pagamento. Foram atualizadas para usar o contrato de aceite de OTP vigente, CPF válido e estado `payment_pending`: selecionar uma forma de pagamento não comprova pagamento concluído.

## Limites

Não acrescenta migration, canal de comunicação ou liberação automática de cupons. A transação protege cada alteração local; não engloba toda a conversa, entrega de OTP, cadastro externo de comprador ou telemetria de seleção de frete.

Ainda precisam de trabalho os demais escritores comerciais, como cross-sell e carrinho conversacional do storefront, a revalidação global no pagamento, orçamento e concessão dos incentivos vinculados à estratégia, economia integral, aprendizado entre lojas e validação operacional do piloto. As regras determinísticas continuam sendo a autoridade comercial; esta entrega não demonstra lucro nem aumento de receita.
