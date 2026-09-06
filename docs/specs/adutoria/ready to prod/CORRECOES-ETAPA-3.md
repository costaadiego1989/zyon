# Correções — terceira etapa da API

Branch: `fix/ready-to-prod-audit`. Base: `ebb954a`. **Produção continua NO-GO.**

Este lote trata pagamentos (API-012 a API-015), mensageria (API-016 e API-037) e estoque após venda (API-017). As alterações ficam no worktree isolado `C:/Users/Admin/Desktop/AACP/.audit/ready-to-prod-fixes-20260905`. O workspace principal continua independente; a integração com as alterações de outro agente ainda precisa ser revisada.

## Responsabilidades e comportamento

Os subagentes trabalharam em pagamentos, outbox e inventory. O agente principal integrou o schema e os consumidores, corrigiu a transação de conclusão do pedido e executou regressões entre módulos. Uma revisão independente confrontou pagamentos e checkout. As implementações de suporte, sessões, OTP e quotas dos lotes anteriores permanecem na mesma branch.

O pagamento passa a registrar os componentes do valor em centavos. A confirmação interna consulta a intenção persistida pelo merchant, sessão e ID, confere aprovação, ID do provedor, moeda e valor, e valida o carrinho. Campos adicionais enviados no body HTTP não constituem prova de aprovação. O fingerprint de novos pagamentos vincula SKU, produto/variante, quantidade, preço, moeda, referência de carrinho, desconto e frete. Intenções legadas sem esse vínculo exigem conciliação; não inventamos retrospectivamente os itens cobrados.

O evento `order.completed` inclui o snapshot versionado da venda. O consumidor de estoque não depende de uma leitura posterior do carrinho para eventos novos. Pedido, evento analítico e outbox são gravados na mesma transação. O teste real expôs e permitiu corrigir duas falhas nesse caminho: tentativa de abrir transação no client já transacional e recuperação de conflito de unicidade dentro de uma transação PostgreSQL abortada. O writer usa inserção com tratamento de conflito no próprio SQL e distingue replay compatível de alteração de valor/moeda/oferta.

O dispatcher compartilha claims duráveis entre réplicas, renova leases e exige o token vigente para confirmar handlers, concluir ou reagendar eventos. Os métodos antigos de confirmação sem claim também ficam bloqueados no adapter de checkout. O worker de estratégia deixa de disputar a mesma tabela por polling independente; usa um handler com ID estável e grava sua lição sob lock do vínculo merchant/hipótese/experimento. Replays retornam a mesma lição persistida.

O encerramento do dispatcher cessa novas aquisições e aguarda trabalho ativo com prazo explícito. Prisma desconecta em `onApplicationShutdown`, depois dos hooks de drenagem. O teste de lifecycle utiliza Nest e PostgreSQL reais; isso não certifica encerramento de todos os jobs, subprocessos ou a configuração de SIGTERM do ambiente produtivo.

Contratos e limites por frente: [pagamentos](CORRECOES-PAGAMENTOS.md), [outbox](CORRECOES-OUTBOX.md) e [estoque](CORRECOES-INVENTORY.md).

## Verificação e evidências

Implementação salva em `9d09a83baaa9b8f51a298de746af5ed6d1db31cb`, com 80 arquivos de código, schema, migração e testes. A execução consolidada terminou com **1.140 testes: 1.099 passaram, 33 falharam e 8 foram ignorados**. As 33 falhas também aparecem na baseline ampliada (`1.028 testes: 987 passaram, 33 falharam e 8 ignorados`); a comparação por nome não encontrou falhas novas. A suíte inteira ainda não está verde. Os oito skips são um teste preexistente de e-mail duplicado e sete E2E de pagamentos que exigem opt-in e provedores externos.

Typecheck e emissão isolados passaram, assim como os três testes HTTP adicionais e a composição de dependências do AppModule. Uma execução anterior esgotou as conexões do PostgreSQL descartável em três testes; o executor agora limita os arquivos simultâneos a dois e o pool padrão a quatro conexões por client, preservando as disputas concorrentes dentro dos testes. A seleção completa foi repetida após o ajuste.

O acumulado dos 68 achados fica em **15 implementados com validação local, 7 parciais, 3 mitigados com capacidade indisponível e 43 abertos**. Nenhum gate de produção foi encerrado. API-013 e API-015 continuam parciais pela recuperação operacional e inbox financeira incompletas; API-016 depende também da idempotência dos demais consumidores.

Os resultados consolidados e hashes do código deste lote ficam em [evidence/corrections-stage3](evidence/corrections-stage3/README.md). A comparação usa uma cópia do commit anterior `ebb954a`, com a mesma seleção ampliada de módulos e os mesmos aliases locais. O aumento do número de falhas na baseline em relação ao lote anterior decorre da inclusão de payment, inventory, revenue-manager e mensageria; não deve ser interpretado isoladamente como regressão introduzida pelo patch.

Os testes usam PostgreSQL e Redis descartáveis em loopback. Não houve envio a provedores reais, push, merge ou deploy. O client Prisma e os arquivos compilados ficam dentro deste worktree; `node_modules` compartilhados não são regenerados. Typecheck/emissão isolados não equivalem ao build de release a partir do lockfile.

## Integração e limitações para produção

Aplicar as três migrações aditivas no diretório ativo da versão integrada, depois da baseline existente:

- `20260906010000_payment_recovery_cas`: versão de concorrência, composição do valor e estado durável de criação.
- `20260906011000_outbox_leases`: lease e índice para aquisição/recuperação.
- `20260906012000_inventory_sale_receipts`: recibo de venda e unicidade por loja/pedido.

Este worktree usa `prisma/migrations`; a versão do outro workspace auditado usava `prisma/deploy-migrations`. Não substituir a baseline. Drenar escritores antigos antes de liberar os novos: eles ignoram versões, leases e recibos. Rollback para esses escritores reabre as falhas mesmo que o schema permaneça aditivo.

Antes de replay, conciliar pagamentos legados sem dados de criação/composição, movimentos de estoque anteriores sem recibo, eventos já marcados como entregues pelo worker antigo e eventos sem snapshot da venda. Definir retenção dos recibos e marcadores: removê-los pode permitir repetição de efeitos.

Persistência e lease não tornam um provedor externo transacional. Timeouts podem exigir conciliação manual; CRM pode repetir efeitos e o adapter ERP ainda está ausente. O estoque de inventory continua uma projeção distinta do estoque do catálogo. Entregas de webhook enfileiradas ainda dependem do dispatcher externo, cujo achado API-018 permanece aberto. Outros consumidores do outbox também precisam provar idempotência de seus próprios efeitos.

Dashboard, storefront e widget_v2 ainda precisam das correções de contrato já auditadas e da validação no navegador. Provedores em sandbox, instalação limpa, build de release, carga, topologia de proxy, alertas, operação de dead-letter e recuperação de desastre continuam gates abertos. A [lista acumulada de achados](evidence/corrections/correction-status.json) diferencia implementação local, correção parcial e aprovação de produção.
