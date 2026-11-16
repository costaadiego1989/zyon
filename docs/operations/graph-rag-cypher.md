# GraphRAG / Cypher do Zyon

O Neo4j é uma projeção derivada do catálogo e do conhecimento público. PostgreSQL continua decidindo preço, estoque, avaliação e elegibilidade da variante. A IA propõe critérios estruturados; não escreve nem executa Cypher livre.

## Comportamento implementado

- Templates parametrizados percorrem somente nós e relações da loja autorizada. A similaridade vetorial é calculada depois desse recorte. A seleção é limitada e não equivale a uma busca exaustiva ou a um índice ANN global.
- Modelo multilíngue `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, revisão `2c4055b12046f11709e9df2c122e59ffbdc2f900`, q8, 384 dimensões. O primeiro uso baixa os artefatos públicos; depois a inferência usa o cache local. Não usa `OPENAI_API_KEY` e não mistura embeddings dos índices legados.
- Depois de uma busca lexical sem resultados, candidatos semânticos podem ser consultados quando o servidor permite essa alternativa. Cursores, consultas de identificação e exigências explícitas de exclusividade preservam a busca original. Resultados semânticos são apresentados como opções relacionadas e seleção parcial.
- Cada candidato é conferido novamente no catálogo público por versão e hash. Uma nova consulta canônica aplica os critérios comerciais à mesma variante. O leitor de recomendações calcula o preço promocional autorizado antes de aplicar o orçamento original.
- FAQ público de atendimento e campos explícitos das políticas têm IDs, hashes e versão. A resposta usa o conteúdo público atual, nunca o texto do grafo sem validação. Documentos removidos ou alterados são descartados. FAQs específicas de páginas de produto ainda não entram nesta primeira projeção.
- Eventos notificam a necessidade de releitura; seus payloads não são indexados. A reconciliação ocorre a cada dois minutos. Uma enumeração incompleta não apaga fontes ausentes. Tombstones impedem eventos antigos de ressuscitar produtos. A validade máxima de leitura é cinco minutos.
- Se o grafo falhar, a consulta tenta o índice PostgreSQL existente e relê cada FAQ/política na fonte pública atual. Textos alterados, revogados, privados ou de outra loja são descartados. O shutdown interrompe novas sincronizações e drena o trabalho ativo antes de fechar os drivers.
- Frete por candidato, novos filtros de linguagem natural e atendimento a objeções continuam sendo capacidades distintas. Cypher não substitui classificação conversacional, cotação de frete nem consentimento para alterar o carrinho.

## Configuração da API

Por padrão a função fica desligada. Variáveis necessárias:

| Variável | Uso |
| --- | --- |
| `GRAPH_RAG_ENABLED` | Literal `true`, somente após os gates |
| `GRAPH_RAG_MERCHANT_IDS` | IDs de lojas separados por vírgula, máximo 20 |
| `NEO4J_URI` | Endpoint privado; nenhuma credencial na URI |
| `NEO4J_DATABASE` | Padrão `neo4j` |
| `NEO4J_READ_USER`, `NEO4J_READ_PASSWORD` | Identidade exclusiva de leitura |
| `NEO4J_WRITE_USER`, `NEO4J_WRITE_PASSWORD` | Identidade de projeção distinta |

Para o Community aprovado pelo usuário, configurar também `GRAPH_RAG_QUERY_MODE=community_gateway`, `GRAPH_GATEWAY_URL=http://graph-query.railway.internal:8080`, `GRAPH_GATEWAY_KEY_ID=athom-v1` e `GRAPH_GATEWAY_KEY` por referência ao segredo do serviço privado. A API não recebe a senha do usuário de consulta desse serviço. As variáveis de leitura direta não são usadas neste modo.

A admissão consulta os papéis reais da identidade de leitura e exige somente `reader`/`PUBLIC`. Configuração incompleta, papéis inadequados ou falha nessa verificação deixam as consultas e a sincronização desativadas. O modo `READ` do driver é roteamento, não uma permissão de segurança. Em modo local, apenas endpoints literais de loopback e `production=false` admitem a credencial administrativa do teste.

As constraints de identidade estão em `ALL_GRAPH_SCHEMA_STATEMENTS`, exportado por `application/graph-schema.ts`, e são criadas pelo operador usando a identidade de escrita antes da ativação. O conjunto mantém as seis constraints legadas e acrescenta as duas do namespace `ZyonPublicSourceV1`/`ZyonPublicChunkV1`; não renomeia nem migra os nós existentes. O teste local de indexação executa esse mesmo conjunto no Neo4j próprio e exige as oito constraints. O caminho de consulta nunca executa DDL. Leitura direta exige o papel reader; no Community, usar o gateway privado aprovado e validar sua admissão autenticada.

## Instância Railway preparada em 03/11/2026

- Projeto `b8421237-6557-4677-a08c-c93453b08568`, ambiente production.
- Serviço `neo4j`, ID `43301b5a-1842-43fd-887a-bd1e9e0b2da7`.
- Volume `neo4j-data`, ID `b2356dae-e5e3-4a67-ad8b-938eb336a340`, 1 GB em `/data`.
- Endpoint privado `neo4j.railway.internal:7687`, sem domínio público ou proxy TCP criado.
- Imagem Community 5.26 fixada por digest `sha256:249a1ec6e3c52d82101a5ed33d6ed2b5ed5b0017b21a28c0bfebc335e87fb177`.
- Deploy `ba042d3a-f612-4704-a3a6-5dd5161665e7`: SUCCESS. Consulta autenticada confirmou Neo4j 5.26.32 Community e `roles=NULL` para o usuário administrativo.
- As seis constraints de identidade foram criadas e conferidas por consulta autenticada. Não foram projetados dados de compradores, pedidos ou pagamentos.

**Leitura direta:** Community não oferece o papel reader e continua reprovado nesse modo. O usuário escolheu explicitamente um serviço privado de consultas controladas, sem licença Enterprise. A implementação desse modo usa autenticação HMAC, nonce/timestamp, proteção contra replay, modelo e fingerprint de templates fixos, escopo de loja, limites de corpo/concorrrência/tempo e respostas assinadas. Não aceita Cypher livre ou escrita. A conta Community continua implicitamente administrativa; a restrição de consulta é fornecida pelo serviço separado. O modo direto preserva sua verificação de reader.

Serviço privado preparado: `graph-query`, ID `8c56a46c-5c6e-443e-992e-bdddfa6b7f1f`, endpoint `graph-query.railway.internal:8080`. Usuários distintos `zyon_graph_query` e `zyon_graph_indexer` foram criados no Neo4j. O restart `cd414e5c-dd7e-452e-9d44-d7c2cfa69584` terminou em SUCCESS e preservou as seis constraints no volume. Credenciais foram configuradas sem impressão dos valores. Publicação e ativação da API permanecem pendentes da revisão independente e das provas do ambiente servido.

## Validação reproduzível

Na raiz do repositório, com Docker disponível:

```powershell
node --loader ./apps/api/tests/ready-prod-loader.mjs apps/api/tests/graph-rag.integration.mjs --local-disposable
docker build -f apps/graph-query-gateway/Dockerfile -t zyon-graph-query:qa-20261103 .
pnpm --filter @zyon/graph-query-gateway build
pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit --incremental false --pretty false
```

O teste cria um container próprio com portas apenas no loopback, credencial aleatória e dois tenants sintéticos. Usa inferência real do modelo fixado, testa atributos, FAQ, projeções duplicadas, tombstones e isolamento, e para somente o container cuja identidade e etiqueta conferiu. Não lê conexão de produção nem grava pedido, pagamento ou estoque. A credencial administrativa local não prova permissão reader em produção. Os testes unitários usam o bloqueio de rede externo existente no projeto.

Para reversão operacional, desativar `GRAPH_RAG_ENABLED` e reiniciar a API conserva a consulta canônica. Não excluir dados comerciais para reindexar o grafo.

## Referências

- [Vetores e consultas Cypher](https://neo4j.com/docs/cypher-manual/current/indexes/search-indexes/vector-indexes/)
- [Transações no driver JavaScript](https://neo4j.com/docs/javascript-manual/current/transactions/)
- [Usuários e limitações da edição Community](https://neo4j.com/docs/operations-manual/current/authentication-authorization/manage-users/)
- [Modelo multilíngue fixado](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2)
