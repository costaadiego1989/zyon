# Revenue Intelligence — continuidade após resposta bloqueada

Trigésima primeira entrega local. Quando uma resposta experimental é definitivamente bloqueada antes da publicação, a recuperação automática pode encerrar aquela tentativa e liberar uma mensagem nova no checkout habitual. Não reenvia a pergunta, a resposta ou ferramentas da tentativa anterior.

## Evidência exigida

A recuperação depende da flag `CHECKOUT_CHAT_SUPPRESSION_RECOVERY_ENABLED`, inicialmente desligada, além da configuração e lista de lojas da recuperação existente. A proposta inclui `suppressionRecovery: checkout-suppression-recovery-v1` no baseline e no hash revisado. O painel explica esse comportamento antes da decisão do lojista. Propostas anteriores não recebem a política retroativamente.

O banco exige uma publicação imutável com decisão `suppressed`, vinculada à mesma loja, sessão, mensagem, conversa, chamada e resposta concluída. Só é elegível o percurso principal `main_chat_navigation_v2`, que retorna a decisão sem executar ferramentas comerciais. Não pode existir par de mensagens, controle de navegação publicado ou pagamento vinculado à tentativa.

O consumo deve estar conciliado: reserva `settled` e evento de uso correspondente, com moeda, preço, provedor, modelo e custo compatíveis. Consumo desconhecido e estouro de reserva continuam bloqueados. Essa estimativa é calculada a partir dos tokens informados e da tarifa limite; não representa confirmação de faturamento do provedor. A recuperação não atualiza nem apaga reservas ou eventos financeiros.

Não basta uma exceção, timeout, ausência de resposta ou conclusão sem decisão de publicação. Esses casos continuam exigindo evidência própria. A recuperação não chama LLM, pagamento ou outro provedor.

## Consistência e medição

A operação bloqueia loja, sessão e recibo na ordem usada pela admissão. Registra a interrupção permanente da participação, a prova de recuperação e o estado terminal do recibo na mesma transação. A atribuição original permanece, incluindo compras posteriores e chamadas já medidas. Outras sessões da loja não são interrompidas.

A migration amplia a guarda da tabela de recuperação existente; não cria outro recibo concorrente. A prova exige a interrupção da atribuição e seu vínculo com o estado terminal. Uma gravação parcial é revertida. Tentativas simultâneas devolvem o mesmo recibo. A decisão imutável impede que um worker atrasado publique a resposta descartada.

`participation.stoppedSessions` e `delivery.suppressedTurns` continuam permitindo identificar a interrupção e a resposta bloqueada; `contextExitSessions` permanece restrito às mudanças de contexto da entrega anterior. Não é registrada publicação nem exibição ao comprador. Não se exclui a sessão da comparação.

## Experiência do comprador

O widget consulta a conversa e recupera o recibo automaticamente, inclusive após recarregar. A API informa `response_outcome: withheld` somente quando há prova de supressão recuperada. Não insere uma resposta fictícia no histórico. Um aviso simples informa que a última mensagem ficou sem resposta e que a conversa pode continuar. O aviso desaparece ao enviar uma mensagem nova. Não há botão “Verificar conversa”, reenvio automático ou chamada financeira nessa retomada.

## Validação e limites

- Passaram 44 testes PostgreSQL focados em recuperação, continuidade, seleção e estado de pagamento. Incluem 12 cenários novos de supressão: ambos os grupos e estados de recibo, custo desconhecido/estourado, configuração e isolamento, concorrência, atomicidade, ferramenta comercial, rollback e worker atrasado. A regressão integral de 214 cenários da entrega anterior foi concluída antes desta alteração.
- Passaram 20 testes de domínio e 11 do cliente. A primeira tentativa de usar o loader da API no cliente falhou por resolução de imports sem extensão; o loader próprio do widget executou os 11 testes sem falhas.
- Passaram 24 cenários de navegador do widget e duas jornadas do dashboard, com HTTP controlado. As duas novas jornadas conferem retomada, reload e mensagem seguinte em 390 e 1440 pixels. A captura móvel foi inspecionada; o aviso permanece legível junto ao campo de mensagem.
- TypeScript da API, dashboard e widget e validação do schema Prisma passaram. A migration foi aplicada pelo comando real de pré-implantação em `revenue_release_0928`, em PostgreSQL descartável; repetir o comando não encontrou pendências. Os arquivos de migration normal e de implantação têm hashes idênticos. Não foi regenerado o cliente Prisma compartilhado.

Logs em `.audit/revenue-weekly/`: `suppression-pg.log`, `suppression-domain.log`, `suppression-widget-unit.log`, `suppression-widget-regression.log`, `suppression-dashboard-browser.log`, `suppression-api-types-final.log`, `suppression-dashboard-types.log`, `suppression-widget-types.log`, `suppression-schema.log`, `suppression-migration.log` e `suppression-migration-idempotent.log`. Os ensaios não chamaram provedores reais.

Não houve implantação ou ativação pública. Aprovação/ativação, paridade comercial completa, demais escritores concorrentes, economia integral, incentivos inteligentes, aprendizado entre lojas e piloto continuam sendo entregas distintas. Esse mecanismo não resolve tentativas sem prova de supressão nem custos desconhecidos.
