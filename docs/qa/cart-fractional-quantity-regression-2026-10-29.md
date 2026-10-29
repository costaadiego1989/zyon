# Rejeição de quantidade fracionada no carrinho

O inbox real `d78a49e8-8a21-4632-b32e-a0a0069b7b0d`, recebido em 29/10/2026 às19:35:38Z no deployment `52eab3c2-5bb4-44b1-b756-b654c9684e40` (fonte `1ecd5e6`), pediu quantidade1,5. O carrinho ficou inalterado em6300 centavos, mas a resposta útil foi substituída por uma falha genérica de consulta.

Os logs do turno `c19afe67-27af-43c7-ad89-b1398acbd79a` mostram classifier, main, um retry por ausência de ferramenta e nenhuma ferramenta. Dois controles readonly com o provedor real classificaram ADD_CART/requiresTool:true/needsProductDiscovery:false. Tanto main como retry rejeitaram corretamente a fração, pedindo número inteiro. A condição genérica `required_read_unconfirmed` confundiu a entrada inválida de uma ação com uma consulta factual obrigatória e sobrescreveu a rejeição.

A correção reconhece um comando direto de alteração da quantidade no carrinho com alvo explicitamente fracionado. Após o gate de domínio, devolve uma orientação canônica para informar uma quantidade inteira, sem carregar contexto tardio, narrar, repetir chamadas ou executar ferramenta. O parser não autoriza operações, não arredonda, não calcula preço e não trata valores no nome de produto ou em pesquisas como quantidade. O guard de fatos comerciais permanece integral.

Validação:74/74 testes focados passaram, incluindo consentimento e resultados terminais do carrinho, orçamento imutável e fatos comerciais. O controle candidato `production-decimal-cart-candidate-52e-proof.json` usa o classificador real e módulos candidatos em memória; termina após a classificação, sem tool calls, DB writes, persistência de conversa ou outbound. Não é aceite de WhatsApp publicado.

Uma execução ampliada encontrou uma fixture antiga de `storefront-scope-agent.spec.ts` que conta o histórico sem considerar o lembrete final de transporte. O mesmo teste falha no baseline1ecd5e6 sem esta correção, confirmado em `local-cart-decimal-baseline-scope-fixture.log`; não foi alterado neste patch.

Evidências em `.audit/whatsapp-final-acceptance-20261028`: `production-decimal-cart-52e-logs.json`, `production-decimal-cart-52e-provider-proof.json`, `production-decimal-cart-candidate-52e-proof.json` e `local-cart-decimal-focused-final.log`.
