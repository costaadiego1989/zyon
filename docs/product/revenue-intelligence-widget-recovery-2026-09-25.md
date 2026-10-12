# Revenue Intelligence — recuperação automática no widget

Décima sexta entrega local, no worktree `AACP-revenue-intelligence`, branch `feat/revenue-intelligence-weekly`. Complementa a [recuperação durável do texto](revenue-intelligence-chat-recovery-2026-09-24.md). Não houve implantação, ativação de flags, chamadas pagas de IA ou efeitos comerciais externos.

## Comportamento para o comprador

Uma perda de resposta não exige que o comprador verifique a conversa. O widget consulta automaticamente o estado confirmado e, quando há prova suficiente, recupera a resposta já salva. Não oferece o botão “Verificar conversa” nem pede decisões sobre recibos, reconciliação ou estratégias de IA. A revisão de estratégias pertence ao lojista no dashboard.

Interrupções breves não exibem aviso adicional. Após 1,5 segundo, aparece apenas “Reconectando...”. Sem internet, o aviso explica que o chat será retomado quando a conexão voltar. São permitidas até seis tentativas por episódio montado, com intervalos de 0, 1, 3, 7, 15 e 30 segundos, contados após a tentativa anterior terminar. Cada requisição de recuperação tem timeout de dez segundos. As tentativas pausam sem conexão ou com a aba oculta; timers e listeners são removidos ao sair do chat. Ao esgotar o limite, o chat informa indisponibilidade temporária e encerra as tentativas.

Enquanto o resultado está indefinido, o widget impede novas mensagens, atalhos e início de voz. Não avança localmente para frete/pagamento com base em uma falha de rede. Só libera a próxima mensagem após ler o histórico e confirmar o término da requisição. A recuperação não reinicia o microfone automaticamente.

## Contrato e persistência

- `/embed/start` anuncia a capacidade `chat_protocol: durable_v2`, sem incluir o histórico sob o escopo de início de checkout.
- `GET /embed/chat/state` exige `checkout:chat`, vínculo do token à sessão/loja e retorna `Cache-Control: no-store`. Histórico e recibos são lidos no mesmo snapshot `RepeatableRead`.
- A projeção contém até cinquenta turnos de texto, a identidade da conversa, o recibo solicitado e eventual requisição ativa. Não devolve hashes internos, blocos executáveis ou respostas de pagamento/oferta.
- Cada envio recebe uma chave própria. O widget usa a identidade real da conversa e mantém a mesma referência durante recuperação e recarregamento.
- O novo registro de recuperação no `sessionStorage` contém somente a chave da mensagem, separado por origem de API, loja, sessão e conversa. Não acrescenta texto, token ou resposta comercial nesse registro. Isso não modifica o armazenamento preexistente da aplicação.
- Recuperação consulta o estado e, se necessário, chama `/embed/chat/reconcile`. Nunca reenvia `/embed/chat`, nunca cria sessão de voz e nunca chama o modelo novamente. A confirmação do POST não substitui a leitura posterior do histórico.
- Uma resposta de outra sessão/conversa, recibo malformado ou ausência de prova não libera o envio. O servidor continua expondo requisições ativas quando o armazenamento do navegador está indisponível.

Não há migration nova nesta entrega; a publicação depende do schema e do backend da décima quinta entrega. O contrato anterior continua disponível para sessões legadas. Flags e allowlists permanecem desabilitadas por padrão.

## Validação local

| Verificação | Resultado |
| --- | --- |
| Cliente do widget: chaves, concorrência, perda de resposta/leitura posterior, reload, contrato legado e recibos inválidos | 12/12 |
| Identidade, persistência PostgreSQL e controller embed | 45/45 |
| Guard de origem/escopo, incluindo os endpoints reais de estado e recuperação | 13/13 |
| Recortes de recuperação/publicação da estratégia em PostgreSQL real | 14/14 |
| Navegador: recuperação automática em 320/1440 px, claro/escuro, reload, limite de tentativas, offline, pausa/limpeza e roteamento legado de voz | 9/9 |
| TypeScript do widget e API com cliente Prisma isolado; `git diff --check` | Aprovados |

Os nove cenários de navegador executam o widget real com respostas HTTP controladas; não conectam o navegador ao banco nem a provedores reais. O cenário de aba oculta simula `visibilitychange`. Os cenários de PostgreSQL são evidência separada, no banco descartável `revenue_recovery_final_0924`. As imagens de celular/claro e desktop/escuro foram inspecionadas. Recursos externos de fonte foram bloqueados no navegador de teste.

Logs locais em `.audit/revenue-weekly/widget-{client-tests,api-tests,guard-tests,strategy-tests,browser,browser-lifecycle}.log`; imagens em `widget-browser-results`. Nenhum artefato de auditoria ou dependência foi adicionado ao commit.

## Limites e próximos requisitos

Esta entrega cobre `widget_v2`; SDK, widget antigo e outros canais não foram migrados. A recuperação restaura texto confirmado e não reconstrói blocos interativos, carrinho ou pagamentos a partir do histórico. Não resolve tentativas sem prova de publicação, efeitos incertos de ferramentas/provedores ou uma mensagem que nunca chegou a gerar recibo. Nesses casos, mantém a proteção e termina com indisponibilidade, sem nova chamada de IA.

RI-09 continua parcial. Paridade completa do controle, ferramentas/pagamento, chamadores restantes, evidência de entrega/exposição, custos e resultados, regras de parada e aprovação/ativação ainda são requisitos antes do piloto. Não há evidência de ganho de receita, cupons/descontos experimentais ativos ou aprendizado compartilhado entre lojas.
