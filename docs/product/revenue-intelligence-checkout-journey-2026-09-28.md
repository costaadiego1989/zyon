# Revenue Intelligence — cadastro, compra e medição

Vigésima sexta entrega local. A jornada de compra passou a exercitar os serviços reais de cadastro, verificação de e-mail, reconhecimento, frete, comunicação experimental, preparação de pagamento e conclusão do pedido com PostgreSQL. Os transportes externos são controlados: a confirmação financeira é simulada e persistida antes de ser lida pelo serviço de pedidos.

## Correções

O telefone informado na primeira mensagem não é mais consumido como CPF pela coincidência de ter onze dígitos. CPF explicitamente identificado continua sendo tratado como documento.

O reconhecimento de uma conta verificada pode alterar a identidade da sessão. O banco interrompe permanentemente sua participação experimental; o chat agora reconhece essa interrupção no mesmo turno e permite continuar pelo fluxo normal. A atribuição original permanece imutável, inclusive se a identidade antiga for restaurada. Alterar a identidade não libera chamadas anteriores com resultado incerto.

O registro de interesse em cupom passa a terminar antes da leitura de qualquer sessão protegida por recibo durável, evitando conflito com a própria gravação posterior.

## Evidência local

- 44 cenários PostgreSQL passaram na bateria final, incluindo cinco novos casos de jornada e as regressões de continuação, chat principal e pagamento.
- Controle e tratamento percorrem telefone, e-mail/OTP inválido e válido, nome, CPF, endereço, frete, texto experimental, encerramento, PIX, confirmação simulada, pedido idempotente e medição da conversão. O custo do catálogo permanece registrado no pedido.
- Reconhecimento de comprador recorrente, restauração da identidade antiga e tentativa incerta têm verificações próprias.
- 53 testes de cadastro, extração, contexto monetário e ofertas passaram; um teste antigo continua ignorado. As falhas anteriores de cadastro foram resolvidas corrigindo fixtures que não simulavam aceitação do e-mail OTP e expectativas desatualizadas da ordem de coleta.
- TypeScript da API passou. Não há migration nem alteração visual nesta entrega.

Logs: `.audit/revenue-weekly/strategy-checkout-journey-final.log`, `strategy-journey-customer-final.log` e `strategy-checkout-journey-types-final.log`.

## Limites

As jornadas dos dois grupos usam comunicação sem desconto e sem frete grátis. Elas não comprovam paridade de todas as ferramentas ou contextos comerciais, chamadas reais de IA, entrega de e-mail, cobrança, webhook, jornada pública HTTP ou navegador. A confirmação de pagamento é uma fixture, não uma evidência do provedor.

Aprovação/ativação pública, paridade completa do checkout, economia integral, incentivos e aprendizado compartilhado continuam pendentes. Não houve implantação, ativação ou comprovação de ganho comercial.
