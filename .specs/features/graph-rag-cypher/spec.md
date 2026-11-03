# GraphRAG and controlled Cypher

**Approved**: 2026-11-03 - user: "ENTAO VAMOS IMPLEMENTAR O CYPHER VC JA TINHA FEITO UM PLANO PARA ISSO"

This records the user's authorization to implement the existing GraphRAG plan. The criteria below make that plan executable; there was no separate presentation or new product approval. Infrastructure selection is pending independently and does not block local implementation. Earlier authorization covers Zyon production tests and releases; it does not supply a Neo4j account or authorize a new paid subscription.

## Problem Statement

O Zyon interpreta filtros tipados, mas não consulta um grafo nem combina relações publicadas com vetores. A busca precisa recuperar candidatos por significado sem assumir que similaridade comprova atributos ou condições comerciais.

## Goals

- Implementar consultas Cypher parametrizadas e recuperação híbrida compartilhada pelos canais.
- Projetar somente catálogo e conhecimento publicados, com revisão, origem e exclusão lógica.
- Revalidar os resultados no PostgreSQL e preservar carrinho, pagamento e estoque.
- Produzir prova real em Neo4j isolado e distinguir essa prova da ativação em produção.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Cypher arbitrário gerado pelo LLM | O plano aprovado exige templates controlados. |
| Nova compra, cobrança ou alteração do pedido pago | Recuperação é somente leitura comercial. |
| Dados ou documentos da Cura Viva | Projeto e autorização separados. |
| Novo provedor de frete ou concessão de benefícios | Cotações e regras permanecem nos serviços canônicos; a capacidade por candidato continua uma entrega própria. |
| Ativação de infraestrutura sem definição do ambiente | Instância e credenciais não existem no projeto; a pergunta foi enviada ao usuário. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Arquitetura | NestJS, Prisma, Zod e módulos existentes | Convenções do repositório; sem troca de stack | y |
| Base de implementação | Branch isolada a partir de 9e34b6185 | Preserva a revisão servida e o workspace principal com trabalho concorrente | y |
| Embeddings | Modelo multilíngue isolado, identificado e com 384 dimensões | Não misturar com vetores antigos de outro modelo; português é parte do produto atual | y |
| Busca inicial | Ranking vetorial exato após escopo da loja, com limite de leitura e seleção parcial explícita | Evita que candidatos de outras lojas esgotem uma busca ANN global | y |
| Infraestrutura de produção | Preparação e testes locais continuam; ativação depende do ambiente respondido e de leitura restrita comprovada | Nenhuma assinatura paga nem chave foi fornecida | y |

**Open questions:** nenhuma para o código e a prova local. A configuração externa permanece uma dependência operacional registrada, sem ser inferida como aprovação de gastos.

## User Stories

### P1: Controlled graph retrieval

**User Story**: Como comprador, quero encontrar produtos e informações pelo significado e pelos critérios que informei.

**Acceptance Criteria**:

1. WHEN uma busca válida é compilada THEN o sistema SHALL manter texto e valores exclusivamente em parâmetros e escopo da loja em cada nó e relação consultados. (RAG-01)
2. IF o contrato contém campo desconhecido, vetor inválido ou limites fora do contrato THEN o sistema SHALL rejeitá-lo antes de acessar Neo4j. (RAG-01)
3. WHERE Neo4j está configurado em produção THEN o sistema SHALL admitir somente uma identidade de consulta com papel reader e sem papel de escrita, distinta da identidade de projeção. (RAG-02)
4. IF há timeout, indisponibilidade, resultado malformado, outra loja ou revisão vencida THEN o sistema SHALL preservar o resultado PostgreSQL disponível e não executar escrita comercial. (RAG-02)
5. WHEN vetores do modelo configurado e texto da consulta estão disponíveis THEN o sistema SHALL ordenar candidatos da própria loja por similaridade e evidência lexical dentro dos limites declarados. (RAG-04)
6. IF embeddings não estão disponíveis THEN o sistema SHALL usar a capacidade PostgreSQL existente sem substituir vetores por valores sintéticos. (RAG-04)

**Independent Test**: Consultar no Neo4j real duas lojas sintéticas com vetores próximos e verificar candidatos, parâmetros e ausência de travessia entre lojas.

### P1: Versioned public projection

**User Story**: Como lojista, quero que somente informações publicadas e atuais da minha loja participem da busca.

**Acceptance Criteria**:

1. WHEN uma fonte pública é projetada THEN o sistema SHALL registrar IDs canônicos, versão, hash da origem, modelo de embedding e relações publicadas da mesma loja. (RAG-03)
2. IF uma projeção é repetida ou chega depois de uma versão mais nova ou exclusão THEN o sistema SHALL manter a versão mais nova e impedir a reativação por dado antigo. (RAG-03)
3. WHEN um evento elegível ou reconciliação é processado THEN o sistema SHALL projetar somente lojas habilitadas a partir de leituras canônicas e registrar falhas sem bloquear compras. (RAG-07)

**Independent Test**: Projetar, repetir, atualizar e excluir uma fonte; reenviar sua versão antiga e verificar o tombstone e os resultados físicos no grafo.

### P1: Canonical commercial and document evidence

**User Story**: Como comprador, quero opções verificáveis e respostas que distingam semelhança de adequação comprovada.

**Acceptance Criteria**:

1. WHEN o grafo retorna candidatos de produtos THEN o sistema SHALL revalidar loja, produto ativo, mesma variante, atributos obrigatórios, avaliações públicas e preço/disponibilidade atuais no caminho comercial canônico. (RAG-05)
2. WHERE a correspondência é semântica THEN o sistema SHALL identificá-la como semelhança e seleção limitada sem afirmar correspondência exata. (RAG-05)
3. WHEN uma evidência documental do grafo é recebida THEN o sistema SHALL reler a fonte pública canônica e descartar conteúdo alterado, despublicado ou de outra loja. (RAG-06)
4. WHILE o recurso está desligado ou a loja não está habilitada o sistema SHALL realizar zero conexões Neo4j e manter os fluxos existentes. (RAG-07)
5. WHEN o operador executa o teste de aceitação isolado THEN o sistema SHALL produzir evidência do Neo4j real, isolamento entre duas lojas e ausência de alteração comercial. (RAG-08)
6. IF a infraestrutura ou a leitura restrita de produção não está comprovada THEN o sistema SHALL manter a ativação desabilitada e relatar essa pendência. (RAG-08)

**Independent Test**: Simular mudança de estoque/preço e revogação da fonte depois da projeção; verificar que o resultado final respeita os dados atuais.

## Edge Cases

- IF um atributo negativo não existe na variante THEN o sistema SHALL tratá-lo como desconhecido e não como ausência comprovada.
- IF o conjunto recuperado é limitado THEN o sistema SHALL declarar seleção parcial em vez de ausência global de opções.
- IF a configuração está incompleta THEN o sistema SHALL preservar inicialização e checkout no caminho PostgreSQL.
- IF o texto do usuário ou da fonte contém comandos THEN o sistema SHALL tratá-los como dados sem alterar o template ou o tenant.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| RAG-01 | Controlled retrieval | T1 | Verified |
| RAG-02 | Controlled retrieval | T2 | Verified |
| RAG-03 | Public projection | T3 | In Tasks |
| RAG-04 | Controlled retrieval | T4 | In Tasks |
| RAG-05 | Canonical commerce | T6 | In Tasks |
| RAG-06 | Public documents | T5 | In Tasks |
| RAG-07 | Lifecycle | T7 | In Tasks |
| RAG-08 | Operational proof | T8 | In Tasks |

## Sources

- `C:/Users/Admin/Desktop/AACP/docs/plans/graph-rag-cypher-implementation-2026-10-29.md`: plano existente autorizado pelo usuário.
- `C:/Users/Admin/Desktop/AACP/docs/plans/shopping-intelligence-implementation-2026-10-29.md`: separação entre consulta, cotação e autoridade comercial.
- Neo4j Cypher Manual, vector functions and indexes: vetores, limites e parâmetros.
- Neo4j JavaScript Driver Manual, transactions: modo READ não substitui autorização do banco.

## Success Criteria

- [ ] Oito componentes implementados em commits isolados e critérios rastreados a testes.
- [ ] Prova real de consultas e projeções no Neo4j, sem credenciais em logs.
- [ ] Build, regressão e revisão independente com três mutações adversariais.
- [ ] Estado operacional publicado como implementado/testado/ativado conforme a evidência real.
