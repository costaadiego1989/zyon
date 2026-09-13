# Complemento: consentimento e elegibilidade de campanhas

Data: 13/09/2026. Projeto: AACP/Zyon. Este documento complementa o relatÃ³rio de Cart Recovery e pÃ³s-venda da mesma data.

## O que foi fechado

- O comprador escolhe separadamente E-mail e WhatsApp no checkout ativo. O controle Ã© opcional, nÃ£o vem marcado e informa que a decisÃ£o nÃ£o altera o pedido.
- A tela consulta e grava a preferÃªncia pelo checkout autenticado. Ela nunca recebe `merchantId` ou `buyerId` do navegador como autoridade: ambos sÃ£o derivados da sessÃ£o vinculada ao token embed.
- A preferÃªncia Ã© persistida por loja, comprador, canal e finalidade `marketing`, com versÃ£o de polÃ­tica, origem, data e evidÃªncia da sessÃ£o. A migraÃ§Ã£o nova Ã© `20260913180000_campaign_contact_consent`.
- A alteraÃ§Ã£o dos dois canais Ã© uma Ãºnica transaÃ§Ã£o. Ao remover um canal, os agendamentos pendentes correspondentes sÃ£o cancelados na mesma transaÃ§Ã£o; uma falha nÃ£o deixa uma troca de E-mail/WhatsApp aplicada pela metade.
- Cart Recovery consulta essa permissÃ£o antes de criar tentativa ou acionar o roteador. Se nenhum canal estiver permitido, nada Ã© criado ou enviado. Caso apenas E-mail esteja permitido, o telefone nÃ£o chega ao roteador.
- O despachante de pÃ³s-venda reconsulta a permissÃ£o antes de enviar. Se o comprador revogou ou nÃ£o autorizou, a mensagem Ã© cancelada. Uma preferÃªncia global posterior de conta tambÃ©m bloqueia o canal.
- Antes de criar uma recuperaÃ§Ã£o, o scanner relÃª a sessÃ£o, exige 30 minutos sem atividade, carrinho com itens e ausÃªncia de pedido concluÃ­do ou pagamento aprovado. Falha na consulta de autoridade interrompe o disparo.

Estas regras se somam Ã s proteÃ§Ãµes jÃ¡ existentes: WhatsApp oficial sÃ³ Ã© roteado quando hÃ¡ conexÃ£o Meta vÃ¡lida e template aprovado para a mesma WABA; sem isso o fluxo pode usar E-mail somente quando houver conteÃºdo, serviÃ§o e permissÃ£o para E-mail.

## EvidÃªncia executada

- `prisma validate` e geraÃ§Ã£o do Prisma Client com o schema atualizado, usando URL descartÃ¡vel; nenhuma migraÃ§Ã£o foi aplicada ao banco do projeto ou de produÃ§Ã£o.
- TypeScript da API e do widget V2 sem erros.
- Build de biblioteca do widget V2 concluÃ­do com o controle de preferÃªncias.
- 38 cenÃ¡rios focados aprovados: persistÃªncia, leitura e substituiÃ§Ã£o atÃ´mica de consentimento; isolamento de sessÃ£o/loja; bloqueio e fallback por canal; pedido/pagamento que impedem Cart Recovery; e cancelamento de pÃ³s-venda sem autorizaÃ§Ã£o.

## Antes de liberar campanhas

1. Aplicar `20260913180000_campaign_contact_consent` junto das migraÃ§Ãµes pendentes e executar `prisma generate` no ambiente de implantaÃ§Ã£o. Sem esta migraÃ§Ã£o, a API nova nÃ£o deve iniciar.
2. Conectar cada merchant Ã  Meta e aguardar a aprovaÃ§Ã£o de cada template. A criaÃ§Ã£o nativa e a ediÃ§Ã£o/rollback continuam disponÃ­veis, mas nenhum WhatsApp de campanha deve sair enquanto a revisÃ£o nÃ£o estiver aprovada.
3. Implementar descadastro fora do checkout com token assinado no E-mail e tratamento de `STOP`/opt-out recebido pela Meta. O checkout permite revogar dentro de uma sessÃ£o autenticada; ele nÃ£o substitui esses dois caminhos de descadastro.
4. Persistir um link de retomada autorizado, de uso limitado, que restaure a sessÃ£o/carrinho. A URL genÃ©rica atual nÃ£o Ã© evidÃªncia de retomada segura.
5. Conciliar callbacks dos provedores com os identificadores gravados para diferenciar aceite, entrega, leitura e falha. Antes de escala, executar uma jornada controlada com comprador autorizado e template Meta realmente aprovado.

O endpoint manual `cart-recovery/test-send` Ã© uma ferramenta operacional separada da fila de campanhas. Ele continua sujeito Ã  elegibilidade de template/roteador, mas nÃ£o serve como prova de consentimento nem como validaÃ§Ã£o de entrega a clientes.
