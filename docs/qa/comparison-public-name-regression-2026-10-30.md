# Comparação por nome público — 30/10/2026

Na sessão nova do storefront `conv_baac7ca6-4b4e-47cf-8256-cdf1dcdd62ea`, o pedido de comparar os dois organizadores terminou sem comparação. O turno `0d8269e1-03fd-4de2-8fb5-3ee46b725802`, revisão `1ecd5e6`, executou `compare_products` e recebeu resposta201 sem rejeição de segurança. Os argumentos originais e o texto bruto do provider não foram registrados.

O controle no banco real reproduziu o defeito do handler: buscar `Kit Organizador Essencial` e `Kit Organizador Completo` encontrava um produto para cada consulta, mas o handler exigia igualdade com todo o nome publicado. Os prefixos e sufixos dos nomes impediam a comparação, mesmo com candidatos únicos.

A correção usa uma porta somente de leitura que retorna apenas nomes e IDs públicos, ativos e não excluídos, dentro da loja. Consulta até três páginas estáveis de100nomes. Só resolve após concluir a cobertura: igualdade normalizada tem prioridade; uma frase contígua única também resolve; duplicatas e ambiguidade exigem escolha. Ausência do leitor, falha, ciclo ou limite de cobertura geram `limited`, sem afirmar inexistência ou selecionar o primeiro resultado. Os IDs selecionados são reidratados e revalidados em loja/atividade; referências duplicadas ao mesmo produto não criam uma comparação consigo próprio. Comparação por ID não varre nomes.

O DTO inclui `nameResolution` e descrição pública de até4000caracteres, com indicação de truncamento. A mudança não concede autorização de carrinho, compra, desconto ou frete.

171 testes focados passaram, incluindo escopo, paginação, limite, ambiguidade posterior, duplicação, revalidação e preservação dos contratos existentes. Log: `.audit/whatsapp-final-acceptance-20261028/local-comparison-public-name-final-tests.log`.

O candidato carregado em memória na revisão publicada `22e439bb-b6ef-4b7c-9104-9ccba7e05d55` consultou os13nomes públicos reais em uma página completa e retornou os dois produtos corretos, sem nomes ausentes e sem pedido de novos nomes. Provas: `production-comparison-public-name-22e-proof.json`, `production-comparison-candidate-22e-proof.json` e `production-comparison-fresh-session-52e-logs.json`, no mesmo diretório de auditoria.

Essas provas são leituras controladas de handler/repositorio e testes locais. Nenhum deploy, envio ou mutação de produção foi executado nesta correção; o reteste da conversa completa ainda depende da publicação.
