# Cursor terminal da busca — 30/10/2026

O inbox `bde48d1a-ed08-4654-9878-e29a1b91492d` pediu kits organizadores até R$70, sem inclusão nem cobrança. O turno `2c5d223e-b205-46a2-9fde-92b0d89903b7` na revisão `22e439bb-b6ef-4b7c-9104-9ccba7e05d55` concluiu classificador, plano e `search_products`, mas a validação de saída do use-case substituiu a resposta por fallback.

A leitura controlada com provider e catálogo reais comprovou a fronteira: plano válido com teto7000, somente Essencial6000, segurança do agente aprovada; o carrossel carregava `nextCursor:null`, que significa página terminal na ferramenta. O contrato visual aceita cursor string ou ausência. A única falha Zod foi `blocks[0].data.nextCursor`, com tipo esperado string.

O builder agora omite apenas cursor null/undefined. Strings continuam preservadas e tipos inválidos continuam reprovados pelo contrato. Não houve relaxamento de schema, alteração dos critérios, ampliação de busca ou mudança comercial.

A regressão executa agente, projeção real do adapter e use-case: cursor terminal, ausente e string válido; preço6000 e teto7000; tipos inválidos permanecem bloqueados. O controle anterior falhou nos casos terminal/ausente. Depois da correção,125testes passaram, incluindo contratos, planejamento e resultado canônico de compras.

No controle real do candidato, o builder novo foi carregado em memória sobre os dados confirmados do agente publicado. A fala permaneceu igual; a saída passou no schema e no escopo; o use-case manteve um carrossel com o Essencial e deixou de retornar o fallback. Nenhum deploy, envio ou persistência de conversa foi executado.

Evidências em `.audit/whatsapp-final-acceptance-20261028/`: `production-budget-output-contract-22e-logs.json`, `production-budget-output-contract-22e-trial3-proof.json`, `production-budget-output-candidate-22e-proof.json`, `local-shopping-output-contract-before.log` e `local-shopping-output-contract-after.log`.

Os controles1e2 não alcançaram a leitura porque o harness inicial não acomodava a transação interna do repositório dentro da transação externa de leitura. Eles não demonstram outra falha de produção e foram mantidos como histórico. O controle3 conserva uma transação externa READONLY/RepeatableRead e delega a leitura interna ao mesmo snapshot.
