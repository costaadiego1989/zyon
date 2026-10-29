# Consulta inteligente de compras — plano de implementação

Data: 29/10/2026. Projeto: AACP/Zyon. Canais: WhatsApp e storefront. Base de implementação isolada: `f457226`.

## Resultado esperado

Uma pergunta livre deve virar critérios verificáveis, e não uma expressão regular criada para cada exemplo. O comprador pode combinar finalidade, características, intervalo de preço, avaliação, preferência de ordenação e condições de entrega. O sistema retorna apenas opções comprovadas, informa limitações e solicita dados indispensáveis. Busca não altera carrinho, cadastro, estoque nem pagamento.

## Estado atual e limites

O Zyon usa PostgreSQL e a base de conhecimento atual da própria loja. Neo4j/Cypher ainda não estão integrados. O PDF e o projeto Cura Viva não pertencem a este catálogo. Na produção Athom, filtros de intervalo de preço e avaliação falharam; `sortBy` era anunciado sem execução. O checkout com cadastro reconhecido e as correções de RAG publicadas permanecem preservados.

## Fase 1 — plano tipado e execução canônica compartilhada

1. Ampliar `search_products` com um contrato versionado de critérios. O LLM atual produz esse plano por argumentos estruturados da ferramenta; não será necessário um segundo modelo para cada consulta.
2. Separar a expressão de produto/finalidade dos filtros numéricos, dos atributos obrigatórios/excluídos/preferidos e da ordenação. Valores monetários usam centavos inteiros; avaliações usam escala 1–5. Campos não suportados são explicitados, nunca descartados silenciosamente.
3. Validar o plano com Zod antes da execução. Rejeitar limites invertidos, números inválidos, condições contraditórias, atributos excessivos e campos de controle/tenant enviados pelo modelo.
4. Executar consultas somente de leitura, sempre no merchant da conversa. Preço, estoque e atributos devem pertencer à mesma variante elegível. Aplicar critérios antes da paginação; ordenar e paginar com desempate determinístico. Avaliação considera somente avaliações públicas aprovadas; ausência de avaliação não satisfaz nota mínima.
5. Preferências não viram exigências silenciosamente. Informar o que não foi confirmado e não declarar que uma alternativa satisfaz todos os requisitos. Atributo ausente é desconhecido, inclusive em uma condição negativa.
6. Manter dados de referência e condições do resultado no contrato de saída. Uma resposta determinística pode substituir narração inválida exclusivamente após leituras canônicas validadas. Nenhum retry de escrita ou relaxamento do contrato do modelo.

Arquivos centrais: `storefront/domain/contracts/shopping-search-plan.schemas.ts`, contratos e definição de `search_products`, `storefront/infrastructure/tool-handlers/product.handlers.ts`, `store-system-prompt.builder.ts`, `catalog/domain/ports/product-repository.port.ts`, `catalog/infrastructure/repositories/catalog-availability-search.ts`, `prisma-product.repository.ts`, `conversation-block.builder.ts` e testes de contrato/integração com provedores simulados.

Aceite: variações e combinações de critérios, faixa de preço, nota mínima, ordenação, dados ausentes, nenhum resultado e erro do modelo têm respostas coerentes nos dois canais. Testes provam isolamento por tenant, mesma variante, moderação de avaliações, paginação e ausência de efeitos comerciais.

## Fase 2 — entrega e benefícios por candidato

Criar capacidade própria de cotação de referência por candidato, sem adicionar itens ao carrinho ou abrir checkout. Reutilizar transportadoras e regras comerciais canônicas com preço, quantidade, dimensões, origem e destino reais. CEP ausente exige pergunta. Não reutilizar de forma indevida o leitor atual restrito a carrinhos, que rejeita `productId`, nem converter tarifa bruta em benefício de frete grátis.

Definir orçamento de consultas, concorrência, timeout e validade das cotações. Resposta deve indicar quando uma pesquisa é parcial. “Frete até X”, “grátis”, “chega até uma data” e “total produto + frete” dependem dessa validação. A fase 1 deve explicitar essa limitação em vez de oferecer resultados que não comprovem uma exigência de entrega.

Aceite: elegibilidade e preço finais conferem com o checkout; nenhuma seleção de frete, reserva, cobrança, compra de etiqueta ou mutação de carrinho é produzida pela busca.

## Fase 3 — GraphRAG e Cypher controlado

Projetar catálogo, categorias, variantes, atributos e documentos publicados da própria loja em um grafo com `merchantId`, IDs canônicos, versão e instante de atualização. A fonte comercial continua nos serviços transacionais. Definir carga inicial e sincronização idempotente por outbox, tombstones, reindexação e medição de atraso antes de ativar consultas.

Traduzir o plano validado para templates Cypher parametrizados de leitura. Não executar Cypher arbitrário produzido pelo modelo. Conexão com permissão somente leitura, escopo obrigatório por tenant em nós e relações, timeout, limite de linhas/profundidade, allowlist de operações e sem procedimentos arbitrários. Recuperar IDs e evidências, revalidar preço, estoque, frete e benefícios nos serviços canônicos antes de responder.

Infraestrutura, credenciais e ativação Neo4j são uma entrega separada. Contrato ou compilador local não constituem integração em produção. Sem grafo disponível, usar o executor PostgreSQL com capacidades declaradas; não anunciar GraphRAG ativo.

Aceite: perguntas relacionais, política publicada versus ausente, dados desatualizados, indisponibilidade do grafo, injeção e tentativa entre tenants são verificadas. Medir precisão da recuperação e satisfação das restrições; não depender apenas de JSON bem formado.

## Fase 4 — publicação e aceite real

Executar testes locais e build; revisar o diff isolado. Publicar revisão imutável somente após os gates técnicos, sem incluir alterações preexistentes do workspace principal. Confirmar revisão em execução, `/ready`, ferramentas e respostas reais no WhatsApp e storefront. Reexecutar os casos QA-13/QA-14 (IDs reais `QR-13`/`QR-14`) e combinações inéditas; guardar inbox, recibo de entrega e estado comercial anterior/posterior.

O agente principal continua os testes restantes da produção atual em paralelo. Resultados locais da implementação não contam como PASS em produção. O Pix final continua por último, com total verdadeiro informado e validação de pedido, estoque, eventos e notificações após a confirmação real do provedor.

## Entregas e critérios de encerramento

- Primeira entrega: fase 1 funcional no código compartilhado e evidência local; fases 2/3 explicitamente pendentes quando não integradas.
- Segunda entrega: cotação por candidato e benefícios, com contrato e validade comercial.
- Terceira entrega: grafo sincronizado, Cypher controlado e prova real de recuperação, sem substituir fontes canônicas.
- Última entrega: revisão publicada e matriz de aceite atualizada com distinção entre teste local, resposta entregue e pagamento real.
