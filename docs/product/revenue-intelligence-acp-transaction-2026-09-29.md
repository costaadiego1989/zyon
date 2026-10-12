# Atualização ACP em uma única transação

Data: 29/09/2026. Continuação da [invalidação comercial](revenue-intelligence-commercial-mutations-2026-09-29.md).

## Problema e comportamento

Um PATCH podia alterar produtos e comprador antes de falhar na seleção de frete ou no cupom. As etapas individuais eram protegidas, mas as anteriores já estavam confirmadas quando a última falhava.

O PATCH completo agora confirma ou desfaz, em conjunto, alterações da sessão, reservas de cupom e eventos. Por exemplo, mudar a quantidade de um para dois e reaplicar um cupom recalcula o benefício sobre o novo total. Se o cupom for inválido, permanecem o carrinho, o benefício e a reserva anteriores.

## Implementação

- `AcpCheckoutUpdateService` é uma dependência obrigatória do ciclo ACP, registrada no módulo. Copia o pedido antes de qualquer espera e compara a versão lida no servidor após adquirir os bloqueios.
- Bloqueios seguem loja, configuração e sessão; autorização de cupom adquire o cupom depois. Catálogo, quantidades, comprador/endereço, frete, reservas e eventos usam o mesmo cliente transacional. Não há chamada a provedor dentro da transação.
- A sequência continua produtos, comprador/endereço, frete e cupom. O cupom de frete usa a opção efetivamente selecionada. Alterar carrinho ou endereço invalida as cotações anteriores: tentar selecionar uma delas no mesmo pedido falha e desfaz todo o PATCH. Uma nova cotação continua sendo necessária.
- `ApplyCouponUseCase` expõe composição interna na transação existente. O caminho individual do widget mantém sua própria transação e as mesmas validações de configuração, custo, margem, região, identidade, capacidade e versão.
- Sessões encerradas, inclusive pedido concluído sem evento de funil, não aceitam atualização. Pedidos de outra loja não acessam a sessão. Mudanças sem efeito comercial preservam os benefícios.
- A resposta ACP é construída dentro da transação e entregue somente após o commit. Não há atualização parcial como alternativa em caso de falha.

## Verificação local

Passaram 51 cenários focados com PostgreSQL descartável: 16 novos do PATCH completo e 35 de regressão de cupons, invalidação e versões ACP. Também passaram 160 testes de aplicação e a checagem TypeScript da API. A primeira execução identificou uma chave incorreta na consulta da fixture de outbox; após a correção, toda a bateria focada passou. A suíte integral de estratégias não foi executada nesta entrega.

Evidências locais: `.audit/revenue-weekly/acp-patch-pg-final.log`, `acp-patch-unit.log` e `acp-patch-types-final.log`. O banco nativo descartável usa UTC; nenhuma migration ou geração do cliente Prisma foi necessária. Não houve teste de navegador, alteração visual ou acesso a provedor real.

Os cenários novos verificam reversão em falhas de cupom, região, opção de frete e gravações finais; preservação de reserva já aplicada; inclusão de produto com custo conhecido/ausente; alterações sem efeito comercial; encerramento; concorrência entre PATCHs, cupom do widget e cancelamento; e ausência de acesso ao cliente externo à transação. Fixtures de orquestração não são tratadas como prova de atomicidade.

## Limites e continuação

Esta entrega cobre o PATCH do checkout ACP da própria loja. Não resolve os demais escritores de cadastro/frete no chat, o carrinho conversacional do storefront, os registros separados de marketplace, a transição completa ao pagamento ou a reserva de estoque. A comparação de versão usa uma leitura inicial do servidor; não acrescenta um contrato HTTP de versão enviada pelo cliente. A consulta ao catálogo não congela preço ou custo durante toda a vida do carrinho.

O próximo marco funcional do motor permanece a ligação da aprovação humana da versão à execução de comunicação, com os controles de ativação e validação da jornada. Economia integral, incentivos inteligentes, aprendizados entre lojas e outros canais continuam no plano. Nenhuma implantação, ativação pública, chamada a provedor ou resultado comercial foi demonstrado por estes testes.
