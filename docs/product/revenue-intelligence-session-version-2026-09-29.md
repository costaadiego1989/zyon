# Revenue Intelligence — proteção contra gravações antigas do checkout

Trigésima segunda entrega local. Uma atualização de cadastro, carrinho, frete ou conversa não pode sobrescrever silenciosamente uma alteração mais recente da sessão. Essa proteção complementa a revalidação feita antes de publicar respostas experimentais.

## Contrato de persistência

O repositório carrega `persistenceVersion` a partir da coluna `CheckoutSession.version`, que já existia. É metadado do servidor; os comandos públicos não recebem esse valor do comprador. A migration faz o PostgreSQL avançar o contador em cada atualização, inclusive nas gravações parciais de eventos e de outros adaptadores. Restaurar o carrinho e o horário antigo não restaura a versão. Atribuir outro contador diretamente é recusado.

`saveSession` bloqueia a linha, verifica a versão e grava dentro da transação. Uma sessão participante de estratégia ou vinculada a uma requisição durável exige versão mesmo quando as flags são desligadas. Gravações com uma versão informada também são verificadas fora desses percursos. Chamadores antigos que não informam versão continuam compatíveis somente em sessões sem esses vínculos. Uma corrida na criação não vira atualização cega.

Após salvar, o objeto de trabalho recebe a versão retornada pelo banco. Uma gravação recusada exige nova leitura e reavaliação; não há repetição automática com o conteúdo antigo. Se uma transação externa for revertida, seu objeto de trabalho também deve ser descartado. O contador e os dados da sessão são revertidos juntos no banco.

`saveSessionIfUnchanged` e a publicação do par de mensagens passam a exigir também a versão, além de comparar os dados. A anexação simples de mensagens deixa de depender da precisão do relógio. O registro de eventos bloqueia a sessão antes de ler e atualizar o escore, evitando perda de atualizações concorrentes desse campo.

## Continuidade dos fluxos existentes

- A abertura do checkout relê a sessão após registrar o evento inicial, antes da hidratação e da próxima gravação.
- A seleção do frete retorna a sessão atual após seu evento. Se o carrinho mudou nesse intervalo, não reaplica a cotação antiga.
- O sinal de pedido de cupom é registrado antes de carregar a sessão de trabalho, inclusive no chat habitual.
- Se um desconto progressivo não pôde ser salvo, a resposta não anuncia que ele foi aplicado.
- A API ACP relê a sessão entre alterações de itens, comprador, cupom e entrega. O cancelamento salva o carrinho antes de registrar seu evento, que também avança a versão.

A atribuição original, as interrupções de participação e a medição das compras permanecem preservadas. Duas fixtures que restauravam identidade usando um objeto antigo passaram a reler a sessão antes de restaurar apenas a identidade. Um teste dedicado verifica que reutilizar o objeto antigo é recusado, inclusive quando os dados e o horário foram restaurados.

## Validação local

Os testes usam PostgreSQL descartável em `revenue_release_0928`, serviços reais de aplicação e transportes controlados. Não chamam provedores reais.

- A regressão de execução percorreu 237 cenários: 236 passaram e um teste antigo tentou restaurar diretamente o contador, operação agora recusada. O teste foi corrigido para exigir essa recusa e depois restaurar somente os dados. O reteste final passou nos 14 cenários selecionados, incluindo esse caso, os dois novos fluxos ACP e as proteções de versão. A cobertura combinada inclui 239 cenários distintos; não foi repetida a bateria integral após os ajustes ACP e da fixture.
- Passaram os cinco percursos de cadastro/frete até pagamento no reteste inicial. A revisão também exercitou concorrência entre cinco escritores, restauração de dados/horário, versão adulterada, rollback transacional, separação entre lojas e desligamento de flags.
- A bateria inicial de aplicação passou em 88 testes, com um teste antigo ignorado. A bateria de abertura/eventos/chat passou em 42 testes, com o mesmo teste ignorado e sobreposição com a anterior. Os 38 testes dos componentes ACP passaram.
- TypeScript da API e validação do schema Prisma passaram. A migration `20260929020000_checkout_session_write_version` foi aplicada pelo comando real de pré-implantação e repetida sem pendências. As cópias normal e de implantação têm o mesmo hash. Não houve geração do cliente Prisma compartilhado.

Logs em `.audit/revenue-weekly/`: `session-version-pg-final.log`, `session-version-pg-recheck.log`, `session-version-journey.log`, `session-version-unit.log`, `session-version-callers-unit.log`, `session-version-acp-unit.log`, `session-version-types-final.log`, `session-version-schema.log`, `session-version-migration.log` e `session-version-migration-idempotent.log`.

Durante a investigação, uma execução parcial foi interrompida para incorporar as correções de abertura e telemetria. A primeira fixture de desconto progressivo não tinha custo de produto conhecido; recebeu um custo sintético explícito, mantendo a regra que recusa incentivo quando a margem não pode ser avaliada. Esses ensaios preliminares não são apresentados como regressões integrais aprovadas.

## Limites e sequência

A versão protege a sessão, mas não torna atômicos efeitos que hoje são gravados separadamente. Ainda precisam de tratamento conjunto, entre outros, reserva/cancelamento de cupom com alteração do carrinho, aceitação de venda adicional e respectivos eventos. Os adaptadores que escrevem diretamente devem conservar suas próprias garantias de bloqueio e revalidação.

A releitura ACP preserva as mudanças anteriores, mas não transforma uma atualização com vários campos em transação única. A aplicação de cupons desse canal também precisa ser integrada ao estado comercial persistido da sessão.

A migration cria o contador; a comparação do snapshot pertence ao novo repositório. Desligar flags mantém a proteção. Reverter para um binário antigo que não compara versões não oferece a mesma garantia, mesmo com a migration presente.

Não houve implantação, ativação pública ou demonstração de ganho comercial. Aprovação/ativação pública, paridade comercial, economia integral, incentivos inteligentes, aprendizado entre lojas e piloto continuam pendentes. Esta entrega não libera novas estratégias por conta própria.
