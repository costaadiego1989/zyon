# Seleção inspecionada no writer — 30/10/2026

A admissão de quantidade lê uma linha de carrinho antes do writer. Uma seleção sem adicionais/horário é `optionItemIds:[]` e `serviceSlotId:null`; omitir os campos no comando posterior ativava a seleção legada por variante única.

Quatro controles falharam no baseline `3b753a7`: uma outra operação trocou a única linha da variante por outra seleção de opções ou horário entre a leitura e a seleção do writer, nos alvos0 e2. Sem os seletores explícitos, a nova linha podia ser alterada/removida.

Depois de validar carrinho, variante, quantidade e igualdade dos seletores, a policy materializa a seleção canônica no comando, inclusive[]/null. O handler e o writer recebem a mesma identidade inspecionada. Divergências, ambiguidades e resultado incerto mantêm seus bloqueios anteriores.

117 testes focados passaram, incluindo admissão, estoque, consentimento, seleção real de linhas e preservação de confirmação/unknown. Os novos testes usam reader, policy, handler e seletor canônico reais com portas de persistência simuladas e interleaving explícito. Isso não é prova de concorrência PostgreSQL nem teste de produção.

Logs em `.audit/whatsapp-final-acceptance-20261028/`: `local-cart-inspected-selector-baseline.log` (4 falhas/1 aprovado antes da correção) e `local-cart-inspected-selector-fixed.log` (117 aprovados). Nenhum deploy, envio ou alteração em banco foi executado nesta etapa.
